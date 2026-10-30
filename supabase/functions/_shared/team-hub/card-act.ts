// EXP08 Team Hub agents, A2b: Approve or Not now on a Team Hub card, and the outcome in its thread.
// Plan: the A2b integrated build plan (D1, D8, D9, D12; section 3 "Redeem"). Contract:
// docs/delivery/exp08-team-hub-agents-contract.md, section 5 A2, slice 4. The dispatch seam is one branch
// near the top of paige-ai-chat/index.ts, beside the agent turn's; the logic lives here.
//
// WHAT ONE ACT IS, in order, and NO MODEL RUNS anywhere in it:
//   1. DECIDE (team_hub_decide_card, the asker's JWT). Only the person who asked can decide; the door
//      re-checks the card, the conversation, the seat, the fingerprint and the proposal in its own body.
//      Not now consumes the proposal there and then (nothing can run it afterwards) and stops here.
//   2. READ the proposal the card links (service role, keyed on this person, this workspace, outside any
//      chat thread), and rebuild the door call from it (doorResumeShape), never from the request.
//   3. RESUME through the SAME door dispatch PAIGE chat's door branches use, pinned to that proposal and
//      with exactly its fingerprint approved. The door, never this module, claims it (compare-and-set)
//      and runs what IT stored, under the asker's JWT (`invokeAs`).
//   4. CLASSIFY what the door said (classifyResumedApproval: done / didn't run / couldn't confirm).
//   5. SETTLE the outcome on the card (team_hub_settle_card, service role, the verified approver passed in) BEFORE anything is posted (D9). A "didn't
//      run" whose proposal is still live is consumed there, in the same transaction.
//   6. ACCEPT the outcome turn (team_hub_accept_agent_turn, intent outcome:<card>), 7. POST the outcome
//      in the card's thread (postOnceMore, the agent turn's own idempotent post), read it back, and
//   8. RECORD the team_hub_agent_post receipt (metadata only). Then answer the browser with what
//      actually happened, and the card's state as the member-safe read reports it.
//
// HONEST OUTCOMES (§13). "Done" needs the door to have said it succeeded. "Didn't run" only when
// something positively knows nothing was applied. Everything else is "couldn't confirm". The outcome
// line is the server's, from a closed set; the door's own words never reach the thread.

import {
  findMessage, isTransportError, newTurnToken, postOnceMore, rpcSafe, uuidFrom, type AgentTurnService, type TeamHubAgentKey,
  TEAM_HUB_AGENT_KEYS,
} from "./agent-turn.ts";
import type { TeamHubCaller } from "./chat.ts";
import { A2B_CARD_TOOLS, CARD_KIND, PAIGE_A2B_DM_SCOPE, type DoorInvoke } from "./card-tools.ts";
import { classifyResumedApproval, doorResumeShape, storedRowState, type DoorFamily } from "../paige-turn/resume.ts";
import { CRM_ACTION_CAPABILITY, CRM_PREVIEW_REQUIRED_ACTIONS } from "../crm-command/catalog.ts";
import { PUBLISH_DOOR_CHAT_TOOLS } from "../growth-publish-command/contract.ts";
import { dispatchGrowthPublishChat, type GrowthPublishApprovalQuery } from "../growth-publish-chat.ts";
import { invokeOutcomeUnknown } from "../approval-outcome.ts";
import { confirmFingerprint } from "../confirm-fingerprint.ts";
import { recordCapabilityRun, stableRunId, type CapabilityOutcome } from "../capability-record.ts";

// ---------------------------------------------------------------- the request

/** The one key a Team Hub card-act request carries. Its presence routes the request here. */
export const TEAM_HUB_CARD_ACT_KEY = "teamHubCardAct";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const FINGERPRINT = /^[0-9a-f]{16}$/;
/** An approved card with no outcome this long after its decision is stranded (its request died): a later Approve resumes it. */
export const STRANDED_APPROVAL_MS = 10_000;
const object = (v: unknown): Record<string, unknown> | null => v && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : null;
const uuid = (v: unknown): string | null => typeof v === "string" && UUID.test(v) ? v.toLowerCase() : null;

export type CardActRequest = { conversationId: string; messageId: string; act: "approve" | "decline"; fingerprint: string };

/** Does this raw request body ask for a card act? Its presence alone decides the route. */
export function isTeamHubCardActRequest(raw: unknown): boolean {
  const body = object(raw);
  return !!body && Object.prototype.hasOwnProperty.call(body, TEAM_HUB_CARD_ACT_KEY);
}

/** Strict: the one key and its four fields, nothing else. A tenant, a person, a tool or arguments are never accepted. */
export function parseCardActRequest(raw: unknown): CardActRequest | { problem: string } {
  const body = object(raw);
  if (!body || Object.keys(body).length !== 1 || !(TEAM_HUB_CARD_ACT_KEY in body)) return { problem: "body must be { teamHubCardAct: {...} } and nothing else" };
  const t = object(body[TEAM_HUB_CARD_ACT_KEY]);
  if (!t) return { problem: "teamHubCardAct must be an object" };
  const allowed = new Set(["conversationId", "messageId", "act", "fingerprint"]);
  if (Object.keys(t).some((k) => !allowed.has(k))) return { problem: "unknown field" };
  const conversationId = uuid(t.conversationId), messageId = uuid(t.messageId);
  if (!conversationId || !messageId) return { problem: "conversationId and messageId must be ids" };
  if (t.act !== "approve" && t.act !== "decline") return { problem: "act must be approve or decline" };
  if (typeof t.fingerprint !== "string" || !FINGERPRINT.test(t.fingerprint)) return { problem: "fingerprint must be the card's token" };
  return { conversationId, messageId, act: t.act, fingerprint: t.fingerprint };
}

// ---------------------------------------------------------------- outcomes

/**
 *   done | failed | unconfirmed   Approve: what the door did (failed = nothing ran; unconfirmed = check first).
 *   declined                       Not now: the proposal is consumed; nothing ran.
 *   expired                        The proposal ran out of time before the decision. Nothing ran.
 *   already_decided                The card was decided before (another tab, or redeemed elsewhere).
 *   not_yours                      Only the person who asked can decide this card.
 *   not_visible                    The conversation (or the card) is not visible to this person now.
 *   conversations_off              Team conversations are switched off for this seat.
 *   could_not_start                Nothing could be decided just now. Ask again.
 */
export type CardActOutcome = "done" | "failed" | "unconfirmed" | "declined" | "expired" | "already_decided" | "not_yours"
  | "not_visible" | "conversations_off" | "could_not_start";
export type CardActResponse = {
  ok: boolean;
  outcome: CardActOutcome;
  /** The card as team_hub_card_states reports it (never its arguments), or null when it could not be read. */
  card: Record<string, unknown> | null;
  /** The outcome message, read back in the card's thread, or null when none was posted. */
  outcome_message: Record<string, unknown> | null;
};
export type CardActResult = { status: number; body: CardActResponse | { ok: false; outcome: "invalid_request"; error: string } };

/** The outcome lines, the server's only (owner frames, plan section 9). */
export const OUTCOME_LINE = {
  done: (note: string) => `Done. ${note}`,
  failed: (reason: string) => `That didn't run: ${reason}. Nothing was changed.`,
  unconfirmed: () => "I couldn't confirm that ran. Check it before asking again.",
};
/**
 * What "done" says for each kind when nothing more specific can be read. A page is never called live
 * without its address (the chat's own publish rule), so its fallback says where to check instead.
 */
export const DONE_NOTE: Readonly<Record<string, string>> = Object.freeze({
  task_handover: "The task is handed over.", task_cancel: "The task is cancelled.",
  page_publish: "The page is published. Its address didn't come back, so open it from your pages to check.",
});
const quoteTitle = (title: string): string => {
  const flat = Array.from(title.replace(/\s+/g, " ").trim());
  return `\u201c${flat.length > 120 ? `${flat.slice(0, 119).join("").trimEnd()}\u2026` : flat.join("")}\u201d`;
};

/**
 * The done note, from what now exists (compliance fixes 1 and 3): the task by its title and, for a hand-over,
 * the person by name; the page with the address the door returned. Read with the service role, keyed on this
 * workspace, AFTER the door said it ran. Any read that does not answer falls back to DONE_NOTE.
 */
export async function doneNote(service: AgentTurnService, at: { kind: string; tenantId: string; userId: string; taskId: string | null;
  assignee: string | null; url: string | null }): Promise<string | null> {
  const fallback = DONE_NOTE[at.kind] ?? null;
  if (at.kind === "page_publish") return at.url && at.url.length <= 200 ? `The page is live at ${at.url}.` : fallback;
  if ((at.kind !== "task_cancel" && at.kind !== "task_handover") || !at.taskId) return fallback;
  try {
    const t = await service.from("tasks").select("title").eq("id", at.taskId).eq("tenant_id", at.tenantId).maybeSingle();
    const title = !t?.error && typeof object(t?.data)?.title === "string" && String(object(t?.data)!.title).trim() ? String(object(t?.data)!.title) : null;
    if (!title) return fallback;
    if (at.kind === "task_cancel") return `${quoteTitle(title)} is cancelled.`;
    if (!at.assignee) return fallback;
    if (at.assignee === at.userId) return `${quoteTitle(title)} is handed over to you.`;
    const p = await service.from("profiles").select("full_name").eq("user_id", at.assignee).maybeSingle();
    const name = !p?.error && typeof object(p?.data)?.full_name === "string" ? String(object(p?.data)!.full_name).replace(/\s+/g, " ").trim().slice(0, 80) : "";
    return name ? `${quoteTitle(title)} is handed over to ${name}.` : fallback;
  } catch { return fallback; }
}
/** Why it didn't run, a closed set: never the door's own words, which can carry internal codes. */
export const FAILED_REASON = Object.freeze({
  expired: "the approval ran out of time",
  unusable: "that approval couldn't be used",
  changed: "the task changed after I read it",
  not_ready: "the page isn't ready to go live",
  disabled: "publishing is switched off here",
  refused: "it was refused",
});

// ---------------------------------------------------------------- dependencies

export interface CardActDeps {
  /** The asker's own session (their JWT): decide, settle, post, read back and the card read. */
  caller: TeamHubCaller;
  /** The service role: the proposal and link reads, accept/end, the receipt. */
  service: AgentTurnService;
  /** The verified asker (auth.getUser on the JWT), never from the body. */
  userId: string;
  signal?: AbortSignal;
  /** The request's x-paige-chat-control header. A card act never carries one: it is refused. */
  controlHint?: string | null;
  /** A door call AS THE ASKER (their own JWT), injected by paige-ai-chat. */
  invokeAs?: DoorInvoke;
  /** Test seam for the outcome turn's token. */
  random?: (n: number) => Uint8Array;
}

const result = (outcome: CardActOutcome, extra: Partial<CardActResponse> = {}): CardActResult =>
  ({ status: 200, body: { ok: outcome === "done" || outcome === "declined", outcome, card: null, outcome_message: null, ...extra } });

function decideRefusal(code: unknown): CardActOutcome {
  switch (code) {
    case "conversations_off": return "conversations_off";
    case "not_member": case "not_found": return "not_visible";
    case "not_yours": return "not_yours";
    case "expired": return "expired";
    case "already_decided": return "already_decided";
    default: return "could_not_start";
  }
}

const RECEIPT_KEY = "team_hub_agent_post";

/** Read a door's answer and its HTTP status, 2xx (data) or not (an error carrying the body). */
async function doorAnswer(reply: { data: unknown; error: unknown } | null): Promise<{ body: Record<string, unknown>; error: unknown; status?: number }> {
  if (!reply) return { body: {}, error: new Error("no answer") };
  let body = object(reply.data) ?? {};
  const err = reply.error as { name?: string; context?: { status?: unknown; json?: () => Promise<unknown> } } | null;
  const status = err?.name === "FunctionsHttpError" && typeof err.context?.status === "number" ? err.context.status as number : undefined;
  if (err && typeof err.context?.json === "function") { try { body = object(await err.context.json()) ?? {}; } catch { /* below */ } }
  return { body, error: reply.error, status };
}

// ---------------------------------------------------------------- the act

export async function runTeamHubCardAct(deps: CardActDeps, raw: unknown): Promise<CardActResult> {
  if (deps.controlHint !== undefined && deps.controlHint !== null) {
    return { status: 400, body: { ok: false, outcome: "invalid_request", error: "a card act never carries a chat control hint" } };
  }
  const parsed = parseCardActRequest(raw);
  if ("problem" in parsed) return { status: 400, body: { ok: false, outcome: "invalid_request", error: parsed.problem } };
  const req = parsed;
  const { caller, service } = deps;
  const userId = deps.userId.toLowerCase();
  if (!UUID.test(userId)) return result("could_not_start");

  // The workspace: the server-resolved persona tenant, never the body.
  const persona = await rpcSafe(caller, "get_paige_persona_context", {});
  const personaRow = persona && !persona.error ? object(Array.isArray(persona.data) ? persona.data[0] : persona.data) : null;
  const tenantId = uuid(personaRow?.tenant_id);
  if (!tenantId) return result("could_not_start");
  if (req.act === "approve" && typeof deps.invokeAs !== "function") return result("could_not_start");

  const cardState = async (): Promise<Record<string, unknown> | null> => {
    const r = await rpcSafe(caller, "team_hub_card_states", { p_expected_tenant: tenantId, p_channel_id: req.conversationId, p_message_ids: [req.messageId] });
    const env = r && !r.error ? object(r.data) : null;
    if (env?.ok !== true || !Array.isArray(env.cards)) return null;
    return env.cards.map(object).find((c) => c && uuid(c.message_id) === req.messageId) ?? null;
  };

  // The card's message and the turn that posted it (service role, keyed on this person and workspace), read
  // and checked against the request BEFORE anything is decided (verifier fix 4): a card that is not this
  // conversation's, or not this person's agent turn, is never decided, and a read that does not answer
  // decides nothing either. Deciding first would let a mismatch settle an approved card as failed and
  // consume a proposal the person had just approved.
  let meta: { agent: TeamHubAgentKey; source: string; root: string } | null = null;
  let metaUnread = false;
  try {
    const [m, t] = await Promise.all([
      service.from("team_hub_messages").select("id,channel_id,parent_message_id,agent_key,author_kind").eq("id", req.messageId).eq("tenant_id", tenantId).maybeSingle(),
      service.from("team_hub_agent_turns").select("source_message_id,agent_key,channel_id").eq("posted_message_id", req.messageId)
        .eq("asker_user_id", userId).eq("tenant_id", tenantId).maybeSingle(),
    ]);
    if (m?.error || t?.error) metaUnread = true;
    const msg = m?.error ? null : object(m?.data), turnRow = t?.error ? null : object(t?.data);
    const agentKey = typeof msg?.agent_key === "string" ? msg.agent_key : null;
    if (msg && turnRow && uuid(msg.channel_id) === req.conversationId && uuid(turnRow.channel_id) === req.conversationId
      && msg.author_kind === "agent" && agentKey === turnRow.agent_key && (TEAM_HUB_AGENT_KEYS as readonly string[]).includes(agentKey ?? "")
      && uuid(turnRow.source_message_id)) {
      meta = { agent: agentKey as TeamHubAgentKey, source: uuid(turnRow.source_message_id)!, root: uuid(msg.parent_message_id) ?? req.messageId };
    }
  } catch { metaUnread = true; meta = null; }
  if (!meta) return result(metaUnread ? "could_not_start" : "not_visible", { card: await cardState() });

  // 1. Decide. Asked once: a retry after a lost answer could read the first attempt's own decision as
  // "already decided" by someone else. A lost answer is reported as such, and the card read says the rest.
  const decided = await rpcSafe(caller, "team_hub_decide_card", { p_expected_tenant: tenantId, p_message_id: req.messageId,
    p_decision: req.act, p_fingerprint: req.fingerprint });
  const dec = decided && !decided.error ? object(decided.data) : null;
  if (!dec) return result("could_not_start", { card: await cardState() });
  if (dec.ok !== true) return result(decideRefusal(dec.code), { card: await cardState() });
  // Peer review on #3041: an approval whose request died before it settled (a lost answer, a crash
  // between decide and the door) would otherwise sit unrunnable until it expired. Once the first attempt
  // is clearly over, the approver's own Approve with the same fingerprint resumes it from step 2. The
  // door's own claim still lets the act run once, and settle keeps the first outcome.
  const decidedAt = typeof dec.decided_at === "string" ? Date.parse(dec.decided_at) : NaN;
  const unsettledApproval = dec.already === true && dec.decision === "approved" && (dec.outcome === null || dec.outcome === undefined)
    && req.act === "approve";
  // Within the first attempt's own time it may still be running: say try again (Approve stays), never resume.
  if (unsettledApproval && !(Number.isFinite(decidedAt) && Date.now() - decidedAt >= STRANDED_APPROVAL_MS)) {
    return result("could_not_start", { card: await cardState() });
  }
  const resumed = unsettledApproval;
  if (dec.already === true && !resumed) return result("already_decided", { card: await cardState() });
  if (dec.decision === "declined") return result("declined", { card: await cardState() });
  const confirmationId = uuid(dec.confirmation_id);
  if (dec.decision !== "approved" || !confirmationId) return result("could_not_start", { card: await cardState() });

  // From here the card is approved: every path settles it, and nothing is posted before it is settled.
  const fp = req.fingerprint;
  const readRow = async () => {
    try {
      const r = await service.from("paige_pending_confirmations").select("id,fingerprint,tool_name,args,consumed_at,expires_at,server_issued_at,issued_in_request")
        .eq("id", confirmationId).eq("user_id", userId).eq("tenant_id", tenantId).is("thread_id", null).is("scoped_client_id", null).maybeSingle();
      return r?.error ? undefined : object(r?.data);
    } catch { return undefined; }
  };
  const selectedAt = new Date().toISOString();
  const row = await readRow();
  // A resumed approval runs only the proposal the approver was shown: another fingerprint decides nothing.
  // and only while the door has not claimed it (a claimed one belongs to the attempt that claimed it).
  if (resumed && (!row || row.fingerprint !== fp || row.consumed_at !== null)) return result("already_decided", { card: await cardState() });

  // 2-4. Rebuild the door call from the stored proposal, run it through its door, and classify.
  type Classified = { state: "done" | "failed" | "unconfirmed"; reason?: keyof typeof FAILED_REASON };
  const toolName = typeof row?.tool_name === "string" ? row.tool_name : null;
  const kind = toolName ? CARD_KIND[toolName] : undefined;
  const storedArgs = object(row?.args);
  let classified: Classified;
  const fromKind = (k: "ran" | "not_run" | "unconfirmed", reason: keyof typeof FAILED_REASON): Classified =>
    k === "ran" ? { state: "done" } : k === "not_run" ? { state: "failed", reason } : { state: "unconfirmed" };

  const shape = row && toolName && kind && storedArgs && A2B_CARD_TOOLS.has(toolName) && row.fingerprint === fp
    && await confirmFingerprint(toolName, storedArgs).catch(() => null) === fp
    ? doorResumeShape(toolName, storedArgs, tenantId, {
      crmActionCapability: CRM_ACTION_CAPABILITY as Readonly<Record<string, string>>,
      crmPreviewActions: CRM_PREVIEW_REQUIRED_ACTIONS as ReadonlySet<string>,
      salesTools: new Set<string>(),
      publishTools: PUBLISH_DOOR_CHAT_TOOLS,
    }) : null;
  const rowState = row ? storedRowState(row, Date.now()) : null;
  let publishedUrl: string | null = null;

  // A stored proposal is not a standing agent grant. Re-resolve the platform-owned
  // scope for this card's verified agent immediately before dispatch, including resumes.
  const currentAgentAllows = async (): Promise<boolean> => {
    if (!toolName || !A2B_CARD_TOOLS.has(toolName)) return false;
    if (meta!.agent === "paige") return (PAIGE_A2B_DM_SCOPE as readonly string[]).includes(toolName);
    try {
      const platform = await service.from("paige_subagents").select("slug,config")
        .eq("slug", meta!.agent).is("tenant_id", null).maybeSingle();
      if (platform?.error || platform?.data?.slug !== meta!.agent) return false;
      const scope = object(object(platform?.data?.config)?.capability_scope);
      return scope?.mode === "allowlist" && scope.access === "card"
        && Array.isArray(scope.tools) && scope.tools.every(t => typeof t === "string")
        && scope.tools.includes(toolName);
    } catch { return false; }
  };

  // The proposal could not be read, so the door was never called: it didn't run, and settling it failed
  // retires the proposal so nothing can run it later (peer review on #3041).
  if (row === undefined) classified = { state: "failed", reason: "unusable" };
  else if (!shape) classified = fromKind(classifyResumedApproval({ spent: false, withheld: true }).outcome, "unusable");
  else if (rowState === "expired") classified = fromKind(classifyResumedApproval({ spent: false, expired: true }).outcome, "expired");
  else if (rowState === "used") classified = fromKind(classifyResumedApproval({ spent: false, lost: true }).outcome, "unusable");
  else if (!await currentAgentAllows()) classified = { state: "failed", reason: "refused" };
  else {
    // The door found nothing to claim for exactly this proposal: re-read it to say why, never guess.
    const claimNotFound = async (again: string | null): Promise<Classified> => {
      if (again) {
        // A door that proposed again minted a live row nobody was shown: retire it (the chat's rule).
        // (A second copy of the chat's re-proposal retire rule, index.ts retireDoorReproposal; recorded in
        // the A2b producer inventory as a write into the confirmations owner's table.)
        try {
          const retired = await service.from("paige_pending_confirmations").update({ consumed_at: new Date().toISOString() })
            .eq("user_id", userId).eq("tenant_id", tenantId).eq("tool_name", toolName).in("fingerprint", [...new Set([fp, again])])
            .is("thread_id", null).is("scoped_client_id", null).is("consumed_at", null).not("server_issued_at", "is", null)
            .neq("issued_in_request", String(row!.issued_in_request ?? "")).gte("server_issued_at", selectedAt);
          if (retired?.error) console.error("[team-hub card] a re-proposal could not be retired:", retired.error.message ?? "error");
        } catch (e) { console.error("[team-hub card] a re-proposal could not be retired:", (e as Error)?.message); }
      }
      const now = await readRow();
      const s = now ? storedRowState(now, Date.now()) : null;
      if (s === "live") return fromKind(classifyResumedApproval({ spent: false, refusal: "unclaimable" }).outcome, "unusable");
      if (s === "expired") return fromKind(classifyResumedApproval({ spent: false, expired: true }).outcome, "expired");
      return fromKind(classifyResumedApproval({ spent: false, lost: true }).outcome, "unusable");
    };
    const family: DoorFamily = shape.family;
    if (family === "publish") {
      const dispatched = await dispatchGrowthPublishChat({ tenantId, userId, toolName: toolName!, args: shape.callArgs,
        approved: new Set([fp]), sameToolCalls: 1, pinned: { fingerprint: fp, args: storedArgs } }, {
        admin: { from: (name: string) => ({ select: (columns: string) => service.from(name).select(columns) as GrowthPublishApprovalQuery }) },
        invoke: (body) => deps.invokeAs!("growth-publish-command", body),
      });
      const c = dispatched.content;
      if (typeof c.url === "string" && c.url.trim()) publishedUrl = c.url.trim();
      if (dispatched.approvalUnavailable === true || c.needs_confirm === true) classified = await claimNotFound(null);
      else {
        const k = classifyResumedApproval({ spent: !!dispatched.spent, spentContent: JSON.stringify(c), refusal: dispatched.refusal }).outcome;
        classified = fromKind(k, c.missing || /ready/i.test(String(c.error ?? "")) && c.not_applied ? "not_ready" : c.disabled ? "disabled" : "refused");
      }
    } else {
      // The body the chat's pinned door branch sends: the command and key the door STORED, and the token.
      let reply: { data: unknown; error: unknown } | null = null;
      try {
        reply = await deps.invokeAs!("crm-command", { command: storedArgs!.command, expected_tenant_id: tenantId,
          idempotency_key: storedArgs!.idempotency_key, approved_fingerprint: fp });
      } catch (e) { reply = { data: null, error: e }; }
      const { body, error, status } = await doorAnswer(reply);
      let content: Record<string, unknown>;
      if (body.outcome === "approval_required" && typeof body.fingerprint === "string") {
        classified = await claimNotFound(FINGERPRINT.test(body.fingerprint) ? body.fingerprint : null);
        content = {};
      } else if (error || body.ok !== true) {
        const unanswered = invokeOutcomeUnknown(error, body, status) || (error ? body.ok === true : typeof body.ok !== "boolean");
        const notApplied = !unanswered && body.outcome_unknown !== true;
        content = { success: false, not_applied: notApplied, ...(unanswered ? { outcome_unknown: true } : {}) };
        if (!unanswered && body.code === "CRM_APPROVAL_UNCONFIRMED") classified = await claimNotFound(null);
        else classified = fromKind(classifyResumedApproval({ spent: true, spentContent: JSON.stringify(content) }).outcome,
          String(body.code ?? "").includes("VERSION_CONFLICT") ? "changed" : "refused");
      } else {
        content = { success: true };
        classified = fromKind(classifyResumedApproval({ spent: true, spentContent: JSON.stringify(content) }).outcome, "refused");
      }
    }
  }

  // 5. Settle, BEFORE anything is posted (D9). A record only with done: the task this card changed.
  const taskId = uuid(object(storedArgs?.command)?.task_id);
  const note = classified.state === "done" ? await doneNote(service, { kind: kind ?? "", tenantId, userId, taskId,
      assignee: uuid(object(object(storedArgs?.command)?.patch)?.assignee_user_id), url: publishedUrl })
    : classified.state === "failed" ? FAILED_REASON[classified.reason ?? "refused"] : null;
  const record = classified.state === "done" && (kind === "task_handover" || kind === "task_cancel") && taskId
    ? { destination: "operations_work", record_id: taskId } : null;
  // Service role, with the approver this function verified from the JWT (§59): an outcome is the server's
  // record of what the door did, never something the approver can assert with their own token (Codex P1).
  const settle = await rpcSafe(service, "team_hub_settle_card", { p_expected_tenant: tenantId, p_actor: userId, p_message_id: req.messageId,
    p_outcome: { state: classified.state, ...(note ? { note } : {}), ...(record ? { record } : {}) } });
  const settledEnv = settle && !settle.error ? object(settle.data) : null;
  // A card settled before (another request got here first) keeps that outcome; this one reports it.
  const settledState = settledEnv?.ok === true && typeof settledEnv.outcome === "string" ? settledEnv.outcome as Classified["state"] : null;
  const outcome: CardActOutcome = settledState ?? classified.state;
  if (!settledState) {
    if (!settledState) console.error("[team-hub card] the outcome could not be settled; nothing is posted", JSON.stringify({ lost: isTransportError(settle), code: settledEnv?.code ?? null }));
    return result(outcome, { card: await cardState() });
  }
  // A card settled before keeps ITS note (settle returns it), never this request's or a guess (compliance fix 7).
  const settledNote = settledEnv?.already === true ? (typeof settledEnv.note === "string" && settledEnv.note.trim() ? settledEnv.note.trim() : null) : note;
  const line = settledState === "done" ? OUTCOME_LINE.done(settledNote ?? "").trim()
    : settledState === "failed" ? OUTCOME_LINE.failed(settledNote ?? FAILED_REASON.refused)
    : OUTCOME_LINE.unconfirmed();

  // 6. Accept the outcome turn (service role), with a token that never leaves this function.
  const intent = `outcome:${req.messageId}`;
  const { token, hash } = await newTurnToken(deps.random);
  const accept = await rpcSafe(service, "team_hub_accept_agent_turn", { p_tenant: tenantId, p_asker: userId, p_channel_id: req.conversationId,
    p_source_message_id: meta.source, p_agent_key: meta.agent, p_intent: intent, p_token_hash: hash });
  const acc = accept && !accept.error ? object(accept.data) : null;
  const readBack = async (id: string) => {
    const back = await findMessage(caller, tenantId, req.conversationId, meta!.root, id);
    return "found" in back && back.found.author_kind === "agent" && back.found.agent_key === meta!.agent ? back.found : null;
  };
  if (!acc || acc.ok !== true) {
    const already = acc?.code === "duplicate" ? uuid(acc.message_id) : null;
    return result(outcome, { card: await cardState(), outcome_message: already ? await readBack(already) : null });
  }
  const turnId = uuid(acc.turn_id);
  const receipt = async (o: CapabilityOutcome, code: string) => {
    try {
      // Metadata only, and an agent DM is not team-visible: neither the agent nor the act is named.
      await recordCapabilityRun(service, { tenantId, actorId: userId, capabilityKey: RECEIPT_KEY, outcome: o,
        runId: await stableRunId([RECEIPT_KEY, tenantId, userId, turnId ?? intent, hash]), agentSlug: null,
        detail: { channel: "team_hub", outcome: code } });
    } catch (e) { console.error("[team-hub card] receipt not recorded:", (e as Error)?.message); }
  };
  const end = async () => { if (turnId) await rpcSafe(service, "team_hub_end_agent_turn", { p_turn_id: turnId, p_token_hash: hash }); };

  // 7. Post in the card's thread, under the asker's JWT; asked at most twice with the same token and id.
  const { result: posted } = await postOnceMore(caller, { p_expected_tenant: tenantId, p_channel_id: req.conversationId, p_agent_key: meta.agent,
    p_body: line, p_client_request_id: await uuidFrom(req.messageId, meta.agent, "outcome"), p_parent_message_id: meta.root,
    p_asked_in_message_id: null, p_intent: intent, p_turn_token: token, p_private_answer: false, p_card_outcome: { state: settledState } });
  const env = posted && !posted.error ? object(posted.data) : null;
  const postedId = env?.ok === true ? uuid(object(env.message)?.id) : null;
  if (!postedId) {
    await end();
    await receipt(env ? "capability_refused" : "capability_outcome_unknown", "no_outcome_post");
    return result(outcome, { card: await cardState() });
  }
  const message = await readBack(postedId);
  // 8. The receipt, then the answer.
  await receipt(message ? "capability_succeeded" : "capability_outcome_unknown", message ? "posted" : "unconfirmed");
  return result(outcome, { card: await cardState(), outcome_message: message });
}
