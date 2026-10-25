import { uuid } from "./weekly-commitment-control-intent.ts";
import { weeklyDraftNativeArgs } from "./weekly-draft-chat-claim.ts";
import { createWeeklyDraftDeadline } from "./weekly-draft-deadline.ts";
import { parseWeeklyDraftState, weeklyDraftModelContext } from "./weekly-draft-projection.ts";

type Caller = { rpc(name: "decline_weekly_commitment_chat_draft" | "read_weekly_commitment_chat_draft",
  args: Record<string, unknown>): PromiseLike<{ data: unknown; error: unknown }> };
type Options = Readonly<{
  proposal: Readonly<{ id: string; declinedToken: string; storedArgs: unknown }>;
  scope: Readonly<{ actorId: string; tenantId: string; threadId: string; clientId: null }>;
  runtime: Readonly<{ intentId: string; requestNonce: string }>;
  remainingMs: number; current(): boolean; signal: AbortSignal;
}>;
type Context = NonNullable<ReturnType<typeof weeklyDraftModelContext>>;
type Result = { declineAttempted: boolean; retryAllowed: false; genericFallbackAllowed: false } & (
  | { status: "declined"; context: Context }
  | { status: "observed"; context: Context }
  | { status: "unknown" }
  | { status: "unavailable" }
);

/** Fixed consumer of the ORIGINAL native decline, not a second approval service.
 * The incumbent server supplies its caller-JWT client, verified original selection,
 * surface-declined token, current normal runtime and REMAINING turn budget.
 * Shapes authenticate nobody: native SQL rechecks owner/tenant/thread/executor/token
 * and atomically records the original refusal. A decline reduces authority; it is
 * not another Kit approval or a grant to execute. Still UNADMITTED to Chat here.
 * One decline only. Lost acknowledgment permits one original read in the SAME
 * deadline. A save winning the race is an observation, never a claimed decline.
 */
export async function declineWeeklyDraftChatApproval(caller: Caller, options: Options): Promise<Result> {
  let attempted = false;
  const flags = () => ({ declineAttempted: attempted, retryAllowed: false, genericFallbackAllowed: false } as const);
  const uncertain = (): Result => ({ status: attempted ? "unknown" : "unavailable", ...flags() });
  try {
    const p = options?.proposal, s = options?.scope, r = options?.runtime;
    const expected = p ? weeklyDraftNativeArgs(p.storedArgs) : null;
    if (!expected || !p || !s || !r || !uuid(p.id) || typeof p.declinedToken !== "string" ||
      !/^[0-9a-f]{16}:[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(p.declinedToken) ||
      s.clientId !== null || !uuid(s.actorId) || !uuid(s.tenantId) || !uuid(s.threadId) ||
      !uuid(r.intentId) || !uuid(r.requestNonce) || !Number.isFinite(options.remainingMs) ||
      options.remainingMs <= 0 || options.remainingMs > 12000 || typeof options.current !== "function" ||
      !options.signal || typeof options.signal.aborted !== "boolean" || typeof caller?.rpc !== "function") return uncertain();
    const scope = Object.freeze({ actorId: s.actorId.toLowerCase(), tenantId: s.tenantId.toLowerCase(),
      threadId: s.threadId.toLowerCase() });
    const id = p.id.toLowerCase(), token = p.declinedToken;
    const nativeArgs = Object.freeze({ _confirmation_id: id, _declined_token: token,
      _expected_thread_id: scope.threadId, _intent_id: r.intentId.toLowerCase(),
      _runtime_request_nonce: r.requestNonce.toLowerCase() });
    const { current, signal, remainingMs } = options;
    const expires = performance.now() + remainingMs;
    const active = () => { try { return performance.now() < expires && !signal.aborted && current() === true; } catch { return false; } };
    if (!active()) return uncertain();
    const stage = createWeeklyDraftDeadline(remainingMs, active);
    const project = (raw: unknown): Result => {
      if (!active()) return uncertain();
      const state = parseWeeklyDraftState(raw, scope);
      if (!state || state.confirmationId !== id || state.requestId !== expected._request_id ||
        state.draft.name !== expected._name || state.draft.weekday !== expected._weekday ||
        state.draft.local_time !== expected._local_time || state.draft.timezone !== expected._timezone ||
        state.phase === "awaiting_approval") return uncertain();
      const context = weeklyDraftModelContext(raw, scope);
      return context ? { status: state.phase === "declined" ? "declined" : "observed", context, ...flags() } : uncertain();
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
      const reply = await stage(() => { attempted = true; return caller.rpc("decline_weekly_commitment_chat_draft", nativeArgs); });
      if (!active()) return uncertain();
      return reply?.error === null ? project(reply.data) : await recover();
    } catch { return await recover(); }
  } catch { return uncertain(); }
}
