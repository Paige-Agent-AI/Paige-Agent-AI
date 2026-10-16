import { confirmFingerprint } from "../confirm-fingerprint.ts";
import { canonicalizeCrmCommand, crmApprovalSubject, CRM_ACTION_CAPABILITY, CRM_PREVIEW_REQUIRED_ACTIONS, type CrmAction } from "../crm-command/catalog.ts";
import { resolveCommandContactRefs } from "../crm-command/contact-refs.ts";

/** The preview proposal remains authority. Its canonical card supplies only the
 * original request shape required by the existing CRM door's validation. */
export async function selectPinnedPreviewRequest(input: {
  tool: string;
  fingerprint: string;
  storedArgs: unknown;
  cards: unknown;
  capabilities: Readonly<Record<string, string>>;
  subject(command: Record<string, unknown>): Promise<string>;
}): Promise<{ command: Record<string, unknown>; idempotency_key: string } | null> {
  const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
  if (!object(input.storedArgs) || !object(input.storedArgs.command) || !Array.isArray(input.cards)) return null;
  const stored = input.storedArgs.command;
  if (typeof stored.action !== "string" || input.capabilities[stored.action] !== input.tool
      || typeof stored.preview_id !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(stored.preview_id)
      || typeof input.storedArgs.idempotency_key !== "string" || !input.storedArgs.idempotency_key
      || typeof input.storedArgs.approval_subject !== "string") return null;
  const matching = input.cards.filter((card) => object(card) && card.tool === input.tool && card.fingerprint === input.fingerprint);
  if (matching.length !== 1) return null;
  const card = matching[0];
  if (!object(card) || !object(card.command) || card.command.action !== stored.action
      || card.idempotency_key !== input.storedArgs.idempotency_key
      || (card.command.preview_id !== undefined && card.command.preview_id !== stored.preview_id)) return null;
  if (await input.subject(card.command) !== input.storedArgs.approval_subject) return null;
  return { command: card.command, idempotency_key: input.storedArgs.idempotency_key };
}

type ReadResult = { data: unknown; error: unknown };
interface ReadQuery extends PromiseLike<ReadResult> {
  select(columns: string): ReadQuery;
  eq(column: string, value: unknown): ReadQuery;
  is(column: string, value: null): ReadQuery;
  not(column: string, operator: string, value: null): ReadQuery;
  gt(column: string, value: string): ReadQuery;
  limit(count: number): ReadQuery;
  maybeSingle(): PromiseLike<ReadResult>;
}
export interface ApprovalRecoveryDb {
  from(table: string): ReadQuery;
  rpc(name: string, args?: Record<string, unknown>): PromiseLike<ReadResult>;
}
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const uuid = (v: unknown): v is string => typeof v === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
const time = (v: unknown) => typeof v === "string" ? Date.parse(v) : NaN;
/** Native CAS compares PostgreSQL instants, including all six fractional digits. */
const preciseTime = (v: unknown) => {
  const match = typeof v === "string"
    ? /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:\.(\d{1,6}))?(?:Z|[+-]\d{2}:\d{2})$/.exec(v) : null;
  return match && Number.isFinite(time(v)) ? [time(v), Number((match[1] ?? "").padEnd(6, "0").slice(3))] : null;
};
const sameRevision = (a: unknown, b: unknown) => {
  const left = preciseTime(a), right = preciseTime(b);
  return !!left && !!right && left[0] === right[0] && left[1] === right[1];
};
const notAfter = (a: unknown, b: unknown) => {
  const left = preciseTime(a), right = preciseTime(b);
  return !!left && !!right && (left[0] < right[0] || left[0] === right[0] && left[1] <= right[1]);
};
const stable = (v: unknown): string => JSON.stringify(v, (_key, value) => object(value)
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, value[key]])) : value);
const unavailable = () => ({ v: 1 as const, status: "unavailable" as const });

/** A read projection, never a claim, execution, settlement or executor release.
 * Only immutable server-issued WAIT_APPROVAL columns establish the card's origin.
 * The native stored proposal remains the sole approval/execution authority. */
export async function readPendingApprovalRecovery(input: {
  actorId: string; tenantId: string | null; threadId: string; intentId: string; turnId: string;
  caller: ApprovalRecoveryDb; service: ApprovalRecoveryDb; now?: () => number;
}) {
  const { actorId, tenantId, threadId, intentId, turnId, caller, service } = input;
  const now = input.now ?? Date.now;
  if (![actorId, tenantId, threadId, intentId, turnId].every(uuid)) return unavailable();
  try {
    const scopeHolds = async () => {
      const membership = await service.from("tenant_members").select("tenant_id,user_id,role,status")
        .eq("tenant_id", tenantId).eq("user_id", actorId).eq("status", "active").maybeSingle();
      const thread = await service.from("paige_chat_threads")
        .select("id,tenant_id,caller_user_id,is_archived,interactive_latest_intent,interactive_executor_intent")
        .eq("id", threadId).eq("caller_user_id", actorId).eq("tenant_id", tenantId).maybeSingle();
      const declared = await caller.from("profiles").select("active_tenant_id").eq("user_id", actorId).maybeSingle();
      // Preliminary scope observation; the final native context read follows below.
      const current = await caller.rpc("current_user_tenant_id");
      return !current.error && current.data === tenantId && !declared.error && object(declared.data)
        && declared.data.active_tenant_id === tenantId && !membership.error && object(membership.data)
        && membership.data.tenant_id === tenantId && membership.data.user_id === actorId
        && membership.data.status === "active" && ["owner", "admin"].includes(String(membership.data.role))
        && !thread.error && object(thread.data) && thread.data.id === threadId
        && thread.data.tenant_id === tenantId && thread.data.caller_user_id === actorId
        && thread.data.is_archived === false
        && thread.data.interactive_latest_intent === intentId && thread.data.interactive_executor_intent === null;
    };
    if (!await scopeHolds()) return unavailable();
    const readReceipt = () => service.from("paige_chat_turns")
      .select("id,thread_id,role,created_at,interactive_intent_id,interactive_actor_id,interactive_tenant_id,interactive_terminal_state,bundle_ref")
      .eq("id", turnId).eq("thread_id", threadId).eq("interactive_intent_id", intentId).maybeSingle();
    const receipt = await readReceipt();
    const turn = receipt.data;
    if (receipt.error || !object(turn) || turn.id !== turnId || turn.thread_id !== threadId || turn.role !== "assistant"
      || turn.interactive_intent_id !== intentId || turn.interactive_actor_id !== actorId || turn.interactive_tenant_id !== tenantId
      || turn.interactive_terminal_state !== "WAIT_APPROVAL" || !Number.isFinite(time(turn.created_at))
      || !object(turn.bundle_ref)) return unavailable();
    const bundle = turn.bundle_ref;
    if (!object(bundle.turn_state) || bundle.turn_state.v !== 1 || bundle.turn_state.state !== "WAIT_APPROVAL" || !object(bundle.interactive)
      || bundle.interactive.request_intent_id !== intentId || !Array.isArray(bundle.interactive.effects)
      || bundle.interactive.effects.length > 20 || bundle.interactive.effects.some(effect => !object(effect)
        || !["approval_required", "reported_success", "reported_failure"].includes(String(effect.outcome)))
      || !Array.isArray(bundle.paige_confirm) || bundle.paige_confirm.length < 1 || bundle.paige_confirm.length > 10) return unavailable();
    const cards = bundle.paige_confirm;
    const seen = new Set<string>();
    const confirmations: Array<{tool: string; summary: string; fingerprint: string; command: Record<string, unknown>; idempotency_key: string}> = [];
    const originals: Array<Record<string, unknown>> = [];
    const revisions: Array<{ table: string; id: string; expected: string; coalesceCreated: boolean }> = [];
    const versionHolds = async (revision: typeof revisions[number]) => {
      const current = await service.from(revision.table).select("id,tenant_id,updated_at,created_at")
        .eq("id", revision.id).eq("tenant_id", tenantId).maybeSingle();
      return !current.error && object(current.data) && current.data.id === revision.id && current.data.tenant_id === tenantId
        && sameRevision(revision.coalesceCreated ? current.data.updated_at ?? current.data.created_at : current.data.updated_at,
          revision.expected);
    };
    const pending = async (tool: string, fingerprint: string) => {
      const read = await service.from("paige_pending_confirmations")
        .select("id,user_id,tenant_id,thread_id,scoped_client_id,tool_name,args,fingerprint,summary,issued_in_request,server_issued_at,created_at,expires_at,consumed_at")
        .eq("user_id", actorId).eq("tenant_id", tenantId).eq("tool_name", tool).eq("fingerprint", fingerprint)
        .is("thread_id", null).is("scoped_client_id", null).is("consumed_at", null)
        .not("server_issued_at", "is", null).not("issued_in_request", "is", null)
        .gt("expires_at", new Date(now()).toISOString()).limit(2);
      return !read.error && Array.isArray(read.data) && read.data.length === 1 && object(read.data[0]) ? read.data[0] : null;
    };
    const live = (row: Record<string, unknown>, tool: string, fingerprint: string) => uuid(row.id) && row.user_id === actorId
      && row.tenant_id === tenantId && row.thread_id === null && row.scoped_client_id === null && row.tool_name === tool
      && row.fingerprint === fingerprint && row.consumed_at === null && uuid(row.issued_in_request)
      && notAfter(row.server_issued_at, turn.created_at) && notAfter(row.created_at, turn.created_at)
      && time(row.expires_at) > now();
    for (const card of cards) {
      if (!object(card) || typeof card.tool !== "string" || typeof card.fingerprint !== "string"
        || !/^[0-9a-f]{16}$/.test(card.fingerprint) || seen.has(card.fingerprint) || !object(card.command)
        || typeof card.command.action !== "string" || !Object.hasOwn(CRM_ACTION_CAPABILITY, card.command.action)
        || !/^(contact|company|task)\./.test(card.command.action)
        || CRM_PREVIEW_REQUIRED_ACTIONS.has(card.command.action as CrmAction)
        || CRM_ACTION_CAPABILITY[card.command.action as CrmAction] !== card.tool
        || typeof card.idempotency_key !== "string" || !card.idempotency_key || card.idempotency_key.length > 192
        || typeof card.summary !== "string" || !card.summary.trim()
        || !bundle.interactive.effects.some(effect => object(effect) && effect.tool === card.tool && effect.outcome === "approval_required")) return unavailable();
      seen.add(card.fingerprint);
      const row = await pending(card.tool, card.fingerprint);
      if (!row || !live(row, card.tool, card.fingerprint) || row.summary !== card.summary || !object(row.args)
        || Object.keys(row.args).sort().join(",") !== "approval_subject,command,idempotency_key"
        || !object(row.args.command) || row.args.idempotency_key !== card.idempotency_key) return unavailable();
      // Reuse the native contact-reference and canonical command boundaries. A
      // reference may resolve only to the exact contact the native proposal stored.
      const resolved = { ...card.command };
      if (!(await resolveCommandContactRefs(service, tenantId!, resolved, "approval-recovery")).ok) return unavailable();
      const command = canonicalizeCrmCommand(resolved);
      if (stable(command) !== stable(row.args.command)
        || await crmApprovalSubject(command.action as CrmAction, command) !== row.args.approval_subject
        || await confirmFingerprint(card.tool, row.args) !== card.fingerprint) return unavailable();
      // Read the native CAS fields; an available card is not permission to run
      // against a different record revision. The writer still rechecks on claim.
      const action = String(command.action);
      const record = action.startsWith("contact.") && action !== "contact.create" ? ["contacts", command.contact_id]
        : action.startsWith("company.") && action !== "company.create" ? ["businesses", command.company_id]
        : action.startsWith("task.") && action !== "task.create" ? ["tasks", command.task_id] : null;
      if (record) {
        if (!uuid(record[1]) || typeof command.expected_updated_at !== "string"
          || !Number.isFinite(time(command.expected_updated_at))) return unavailable();
        const revision = { table: String(record[0]), id: record[1], expected: command.expected_updated_at,
          coalesceCreated: !action.startsWith("contact.") };
        if (!await versionHolds(revision)) return unavailable();
        revisions.push(revision);
      }
      originals.push(row);
      confirmations.push({tool: card.tool, summary: card.summary, fingerprint: card.fingerprint,
        command: card.command, idempotency_key: card.idempotency_key});
    }
    if (!await scopeHolds()) return unavailable();
    const finalReceipt = await readReceipt();
    if (finalReceipt.error || stable(finalReceipt.data) !== stable(turn)) return unavailable();
    // Observe revisions again after the awaited scope/receipt checks, then native
    // proposal consumption/expiry/issuance after every record read. These reads
    // are not a transaction or a lease; exact claim/CAS still governs execution.
    for (const revision of revisions) if (!await versionHolds(revision)) return unavailable();
    for (const original of originals) {
      const row = await pending(String(original.tool_name), String(original.fingerprint));
      if (!row || !live(row, String(original.tool_name), String(original.fingerprint)) || stable(row) !== stable(original)) return unavailable();
    }
    // LAST awaited boundary: one incumbent native snapshot for this caller's
    // owned scope/current workspace/latest intent/released canonical terminal.
    // It establishes publication context, never proposal or effect authority.
    const publication = await caller.rpc("paige_chat_interactive_publication_context_v2", {
      p_thread: threadId, p_intent: intentId,
    });
    if (publication.error || publication.data !== true
      || !originals.every(row => live(row, String(row.tool_name), String(row.fingerprint)))) return unavailable();
    return { v: 1 as const, status: "available" as const, thread_id: threadId, turn_id: turnId, intent_id: intentId,
      tenant_id: tenantId!, expires_at: new Date(Math.min(...originals.map(row => time(row.expires_at)))).toISOString(), confirmations };
  } catch { return unavailable(); }
}
