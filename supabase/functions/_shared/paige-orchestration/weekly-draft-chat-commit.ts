import { decideDeclaredOrdinaryCapability } from "../capability-kit/decision.ts";
import { WEEKLY_COMMITMENT_DRAFT_CAPABILITY } from "../paige-spine/domains/automations.ts";
import { uuid } from "./weekly-commitment-control-intent.ts";
import { weeklyDraftNativeArgs, type claimWeeklyDraftChatApproval } from "./weekly-draft-chat-claim.ts";
import { createWeeklyDraftDeadline } from "./weekly-draft-deadline.ts";
import { parseWeeklyDraftState, weeklyDraftModelContext } from "./weekly-draft-projection.ts";

type Gate = Parameters<typeof decideDeclaredOrdinaryCapability>[1];
type NativeClaim = Extract<Awaited<ReturnType<typeof claimWeeklyDraftChatApproval>>, { status: "claimed" }>;
type Caller = { rpc(name: "commit_weekly_commitment_chat_draft" | "read_weekly_commitment_chat_draft",
  args: Record<string, unknown>): PromiseLike<{ data: unknown; error: unknown }> };
type Options = Readonly<{
  claim: NativeClaim; confirmationId: string; confirmationRequestNonce: string;
  scope: Readonly<{ actorId: string; tenantId: string; threadId: string; clientId: null }>;
  runtime: Readonly<{ intentId: string; requestNonce: string }>;
  callerFacts: Gate["caller"]; availability: Gate["capability"]["availability"]; autonomyLane: string;
  remainingMs: number; current(): boolean; signal: AbortSignal;
}>;
type Context = NonNullable<ReturnType<typeof weeklyDraftModelContext>>;
type Result = { commitAttempted: boolean; retryAllowed: false; genericFallbackAllowed: false } & (
  | { status: "saved"; context: Context; record: { automationId: string; receiptId: string; requestId: string } }
  | { status: "observed"; context: Context }
  | { status: "unknown" | "unavailable" }
);

/** Fixed transport after the ORIGINAL native claim, not an approval/execution engine.
 * The incumbent server supplies a FRESH native claim from this same normal turn,
 * never reconstructed/cached claim JSON on reload, plus verified caller/availability/Trust
 * facts, original scope/runtime and REMAINING turn budget. Shapes grant no authority:
 * native SQL rechecks owner, thread, executor, exact claim nonce/args and current lane.
 * Existing Kit decides; only its unchanged stored call reaches the native writer.
 * A lost write acknowledgement permits one original read, never a second commit.
 * Unadmitted until the original Chat owner wires and proves the complete pathway.
 */
export async function commitWeeklyDraftChatApproval(caller: Caller, options: Options): Promise<Result> {
  let attempted = false;
  const flags = () => ({ commitAttempted: attempted, retryAllowed: false, genericFallbackAllowed: false } as const);
  const uncertain = (): Result => ({ status: attempted ? "unknown" : "unavailable", ...flags() });
  try {
    const s = options?.scope, r = options?.runtime, c = options?.claim, facts = options?.callerFacts;
    const expected = c?.status === "claimed" ? weeklyDraftNativeArgs(c.storedArgs) : null;
    if (!expected || c.rpcAttempted !== true || c.retryAllowed !== false || c.genericFallbackAllowed !== false ||
      !s || !r || !facts || s.clientId !== null || !uuid(s.actorId) || !uuid(s.tenantId) || !uuid(s.threadId) ||
      !uuid(options.confirmationId) || !uuid(options.confirmationRequestNonce) || !uuid(r.intentId) || !uuid(r.requestNonce) ||
      typeof facts.userId !== "string" || facts.userId.toLowerCase() !== s.actorId.toLowerCase() ||
      typeof facts.tenantId !== "string" || facts.tenantId.toLowerCase() !== s.tenantId.toLowerCase() ||
      !Number.isFinite(options.remainingMs) || options.remainingMs <= 0 || options.remainingMs > 12000 ||
      typeof options.current !== "function" || !options.signal || typeof options.signal.aborted !== "boolean" ||
      typeof caller?.rpc !== "function") return uncertain();
    const scope = Object.freeze({ actorId: s.actorId.toLowerCase(), tenantId: s.tenantId.toLowerCase(),
      threadId: s.threadId.toLowerCase() });
    const id = options.confirmationId.toLowerCase(), nonce = options.confirmationRequestNonce.toLowerCase();
    const runtime = Object.freeze({ intent: r.intentId.toLowerCase(), nonce: r.requestNonce.toLowerCase() });
    const { current, signal, remainingMs } = options;
    const expires = performance.now() + remainingMs;
    const active = () => { try { return performance.now() < expires && !signal.aborted && current() === true; } catch { return false; } };
    if (!active()) return uncertain();
    const stage = createWeeklyDraftDeadline(remainingMs, active);
    const decision = decideDeclaredOrdinaryCapability(WEEKLY_COMMITMENT_DRAFT_CAPABILITY, {
      caller: { ...facts, access: facts.access ? { ...facts.access } : undefined },
      capability: { id: "weekly_commitment_draft", effect: "mutate",
        availability: options.availability, outcomeChannel: "record_capability_run" },
      approval: { autonomyLane: options.autonomyLane, claimedArgs: expected, claimedFor: "weekly_commitment_draft" },
      requestArgs: expected,
    });
    if (decision.kind !== "execute") return uncertain();
    const decided = weeklyDraftNativeArgs(decision.args);
    if (!decided || Object.keys(expected).some(key => expected[key] !== decided[key])) return uncertain();
    const writeArgs = Object.freeze({ _confirmation_id: id, _request_nonce: nonce, _expected_args: decided,
      _expected_thread_id: scope.threadId, _intent_id: runtime.intent, _runtime_request_nonce: runtime.nonce });
    const project = (raw: unknown): Result => {
      if (!active()) return uncertain();
      const state = parseWeeklyDraftState(raw, scope);
      if (!state || state.confirmationId !== id || state.requestId !== expected._request_id ||
        state.draft.name !== expected._name || state.draft.weekday !== expected._weekday ||
        state.draft.local_time !== expected._local_time || state.draft.timezone !== expected._timezone ||
        state.phase === "awaiting_approval") return uncertain();
      const context = weeklyDraftModelContext(raw, scope);
      if (!context) return uncertain();
      if (state.phase === "saved" && state.automationId && state.receiptId)
        return { status: "saved", context, record: { automationId: state.automationId,
          receiptId: state.receiptId, requestId: state.requestId }, ...flags() };
      return { status: "observed", context, ...flags() };
    };
    const recover = async (): Promise<Result> => {
      if (!attempted || !active()) return uncertain();
      try {
        const read = await stage(() => caller.rpc("read_weekly_commitment_chat_draft", {
          _confirmation_id: id, _expected_thread_id: scope.threadId,
        }));
        return read?.error === null ? project(read.data) : uncertain();
      } catch { return uncertain(); }
    };
    try {
      const written = await stage(() => { attempted = true; return caller.rpc("commit_weekly_commitment_chat_draft", writeArgs); });
      if (!active()) return uncertain();
      return written?.error === null ? project(written.data) : await recover();
    } catch { return await recover(); }
  } catch { return uncertain(); }
}
