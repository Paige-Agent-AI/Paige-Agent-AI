// EXP08 consumer of EXP03's ORIGINAL email adapter. This is not an email writer,
// approval channel, tool registration or provider client. The host must supply
// fresh native actor/DM/roster checks and an explicit exact-content private-context
// handoff. Until those are wired, this module offers no executable Hub capability.
import { commsEmailOperationId, dispatchCommsEmailChat, type CommsEmailChatDependencies } from "../comms-email/chat.ts";
import { COMMS_EMAIL_ACTION, parseCommsEmailCommand, UUID } from "../comms-email/contract.ts";
import { parseCommsEmailDraftSource, type CommsEmailDraftSource } from "../comms-email/draft-source.ts";

export type NexusEmailDraftScope = Readonly<{
  agent: string;
  where: string;
  tenantId: string;
  actorId: string;
  conversationId: string;
  sourceMessageId: string;
  storedTools: readonly string[] | null;
  /** IDs from this accepted turn's permitted original contact/source reads. */
  contactIds: readonly string[];
  /** Optional exact sender selected by the person from original permitted choices. */
  connectorId?: string;
  /** Exact raw source version from the original permitted draft read, if editing. */
  draftSource?: CommsEmailDraftSource;
}>;

export type NexusEmailDraftSelection = Readonly<{
  contact_id: string;
  subject: string;
  body: string;
  save_draft: true;
  connector_id?: string;
  draft_source?: CommsEmailDraftSource;
}>;

export type NexusEmailDraftDeps = Readonly<{
  admin: CommsEmailChatDependencies["admin"];
  invokeAs: (name: string, body: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }>;
  /** Existing native scope check, including current actor, workspace, private DM,
   * role, stored action scope and accepted turn. A roster label is not authority. */
  isCurrent: () => Promise<boolean>;
  /** Host verifies an explicit permitted handoff of THIS exact recipient/content.
   * Model text, model save_draft or mere access to the DM cannot supply this. */
  permitSelection: (selection: NexusEmailDraftSelection) => Promise<boolean>;
  signal?: AbortSignal;
  /** Technical request deadline, never a monetary or standing-authority allowance. */
  timeoutMs?: number;
}>;

export type NexusEmailDraftResult = Readonly<{
  status: "saved" | "refused" | "unknown";
  delivery_confirmed: false;
  draft_source?: CommsEmailDraftSource;
  receipt_id?: string;
  replayed?: boolean;
}>;

const object = (v: unknown): Record<string, unknown> | null =>
  v !== null && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : null;
const result = (status: NexusEmailDraftResult["status"]): NexusEmailDraftResult =>
  Object.freeze({ status, delivery_confirmed: false });
const KEYS = new Set(["contact_id", "subject", "body", "save_draft", "draft_source", "connector_id"]);
const sameSource = (a: CommsEmailDraftSource | undefined, b: CommsEmailDraftSource | undefined): boolean =>
  a === undefined || b === undefined ? a === b : a.message_id === b.message_id && a.updated_at === b.updated_at;

/** Read-only reconciliation identity uses the ORIGINAL adapter's derivation,
 * never a new Hub operation namespace or a model-supplied id. */
export async function nexusEmailDraftOperationId(scope: NexusEmailDraftScope, selected: NexusEmailDraftSelection): Promise<string> {
  const command = parseCommsEmailCommand({ action: COMMS_EMAIL_ACTION, contact_id: selected.contact_id,
    connector_id: selected.connector_id ?? null, subject: selected.subject, body: selected.body });
  return await commsEmailOperationId(scope.tenantId, scope.actorId, command,
    { thread_id: scope.conversationId, user_turn_ordinal: 0, user_turn: scope.sourceMessageId }, undefined, undefined,
    { ...(selected.draft_source ? { source: selected.draft_source } : {}), save_draft: true });
}

/** One saver per ORIGINAL accepted Hub turn. Repeated identical calls share the
 * same in-flight/result promise. Once admitted, changed content cannot mint a
 * second operation, including after an unknown outcome. Native operation replay
 * and original accepted-turn recovery remain authoritative across requests. */
export function createNexusEmailDraftSaver(initial: NexusEmailDraftScope, deps: NexusEmailDraftDeps):
  (input: unknown) => Promise<NexusEmailDraftResult> {
  // Capture before any await. Mutable caller arrays/ports cannot widen this turn.
  const scope = { ...initial, storedTools: initial.storedTools ? [...initial.storedTools] : null,
    contactIds: [...initial.contactIds], draftSource: initial.draftSource ? { ...initial.draftSource } : undefined };
  const current = deps.isCurrent, permit = deps.permitSelection, invoke = deps.invokeAs;
  const admin = deps.admin, signal = deps.signal;
  let key: string | undefined;
  let pending: Promise<NexusEmailDraftResult> | undefined;
  let retired = false;

  function selection(input: unknown): NexusEmailDraftSelection | null {
    try {
      if (scope.agent !== "nexus" || scope.where !== "agent_dm" || !scope.storedTools?.includes("comms_send_email")
        || ![scope.tenantId, scope.actorId, scope.conversationId, scope.sourceMessageId].every(v => typeof v === "string" && UUID.test(v))) return null;
      const args = object(input);
      if (!args || args.save_draft !== true || Object.keys(args).some(k => !KEYS.has(k))) return null;
      if (scope.connectorId !== undefined
        ? !UUID.test(scope.connectorId) || args.connector_id !== scope.connectorId
        : Object.hasOwn(args, "connector_id")) return null;
      const command = parseCommsEmailCommand({ action: COMMS_EMAIL_ACTION, contact_id: args.contact_id,
        connector_id: scope.connectorId ?? null, subject: args.subject, body: args.body });
      if (!scope.contactIds.includes(command.contact_id)) return null;
      const source = Object.hasOwn(args, "draft_source") ? parseCommsEmailDraftSource(args.draft_source) : undefined;
      if (!sameSource(source, scope.draftSource)) return null;
      return Object.freeze({ contact_id: command.contact_id, subject: command.subject, body: command.body,
        save_draft: true, ...(scope.connectorId ? { connector_id: scope.connectorId } : {}), ...(source ? { draft_source: source } : {}) });
    } catch { return null; }
  }

  return (input: unknown): Promise<NexusEmailDraftResult> => {
    const selected = selection(input);
    if (!selected) return Promise.resolve(result("refused"));
    const identity = JSON.stringify(selected);
    if (pending) return identity === key ? pending : Promise.resolve(result("refused"));
    key = identity;
    pending = (async (): Promise<NexusEmailDraftResult> => {
      let dispatched = false;
      let native: Record<string, unknown> | null = null;
      const live = (): boolean => !retired && signal?.aborted !== true;
      const check = async (): Promise<boolean> => {
        if (!live()) return false;
        try {
          const allowed = await current();
          if (allowed !== true || !live()) { retired = true; return false; }
          return true;
        } catch { retired = true; return false; }
      };
      let timer: ReturnType<typeof setTimeout> | undefined;
      let onAbort: (() => void) | undefined;
      const stop = new Promise<NexusEmailDraftResult>(resolve => {
        onAbort = () => { retired = true; resolve(result(dispatched ? "unknown" : "refused")); };
        timer = setTimeout(onAbort, deps.timeoutMs ?? 10000);
        signal?.addEventListener("abort", onAbort, { once: true });
        if (signal?.aborted) onAbort();
      });
      const run = async (): Promise<NexusEmailDraftResult> => {
        try {
          if (!await check() || await permit(selected) !== true || !live()) return result("refused");
          const reply = await dispatchCommsEmailChat({
            tenantId: scope.tenantId, userId: scope.actorId, toolName: "comms_send_email", args: { ...selected },
            approved: new Set(), sameToolCalls: 1,
            // Correlation only. No Chat row, approval or transcript is invented/copied.
            turn: { thread_id: scope.conversationId, user_turn_ordinal: 0, user_turn: scope.sourceMessageId },
            current: live,
          }, { admin, caller: { functions: { invoke: async (name, options) => {
            const body = options.body;
            const command = object(body.command);
            // Final consumer boundary, independent of whatever the model or
            // adapter offered. Only the original native Save branch may run.
            if (dispatched || name !== "comms-email-command" || body.save_draft !== true
              || body.expected_tenant_id !== scope.tenantId || typeof body.operation_id !== "string" || !UUID.test(body.operation_id)
              || Object.keys(body).some(k => !["expected_tenant_id", "operation_id", "command", "save_draft", "draft_source"].includes(k))
              || command?.action !== COMMS_EMAIL_ACTION || command.contact_id !== selected.contact_id
              || command.subject !== selected.subject || command.body !== selected.body || command.connector_id !== (selected.connector_id ?? null)
              || !sameSource(body.draft_source ? parseCommsEmailDraftSource(body.draft_source) : undefined, selected.draft_source)
              || !await check() || await permit(selected) !== true || !live()) throw Error("save_scope_refused");
            dispatched = true;
            const original = await invoke(name, body);
            native = original.error ? null : object(original.data);
            return original;
          } } } });
          if (!dispatched) return result("refused");
          if (!await check() || !live()) return result("unknown");
          const content = reply.content;
          const raw = native as Record<string, unknown> | null;
          if (content.success !== true || content.outcome !== "draft_saved" || raw?.delivery_confirmed === true
            || typeof content.receipt_id !== "string" || !UUID.test(content.receipt_id)) return result("unknown");
          const saved = parseCommsEmailDraftSource(content.draft_source);
          if (selected.draft_source && saved.message_id !== selected.draft_source.message_id) return result("unknown");
          return Object.freeze({ status: "saved", draft_source: saved, receipt_id: content.receipt_id,
            replayed: content.replayed === true, delivery_confirmed: false });
        } catch { return result(dispatched ? "unknown" : "refused"); }
      };
      try { return await Promise.race([run(), stop]); }
      finally {
        retired = true;
        if (timer !== undefined) clearTimeout(timer);
        if (onAbort) signal?.removeEventListener("abort", onAbort);
      }
    })();
    return pending;
  };
}
