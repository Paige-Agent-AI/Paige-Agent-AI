import { uuid } from "./weekly-commitment-control-intent.ts";
import { bindWeeklyControlForReview } from "./weekly-commitment-control-input.ts";
import { createWeeklyDraftDeadline } from "./weekly-draft-deadline.ts";
import { parseWeeklyDraftState, weeklyDraftModelContext } from "./weekly-draft-projection.ts";

type Caller = { rpc(name: "claim_weekly_commitment_chat_draft", args: Record<string, unknown>):
  PromiseLike<{ data: unknown; error: unknown }> };
type ClaimOptions = Readonly<{
  proposal: Readonly<{ id: string; approvedToken: string; storedArgs: unknown }>;
  scope: Readonly<{ actorId: string; tenantId: string; threadId: string; clientId: null }>;
  confirmationRequestNonce: string;
  runtime: Readonly<{ intentId: string; requestNonce: string }>;
  current(): boolean;
  signal: AbortSignal;
}>;
type NoReplay = { rpcAttempted: boolean; retryAllowed: false; genericFallbackAllowed: false };
type ClaimResult = NoReplay & (
  | { status: "claimed"; storedArgs: Readonly<Record<string, string | number>> }
  | { status: "observed"; context: NonNullable<ReturnType<typeof weeklyDraftModelContext>> }
  | { status: "unavailable" }
);
const dataRecord = (raw: unknown): Record<string, unknown> | null => {
  if (!raw || typeof raw !== "object" || ![Object.prototype, null].includes(Object.getPrototypeOf(raw))) return null;
  const descriptors = Object.getOwnPropertyDescriptors(raw);
  return Reflect.ownKeys(raw).some(key => typeof key !== "string" || !("value" in descriptors[key]) ||
    !descriptors[key].enumerable) ? null : raw as Record<string, unknown>;
};
const closed = (r: Record<string, unknown>, keys: string[]) => Object.keys(r).length === keys.length &&
  keys.every(key => Object.prototype.hasOwnProperty.call(r, key));
export function weeklyDraftNativeArgs(raw: unknown) {
  const r = dataRecord(raw);
  if (!r || !closed(r, ["_request_id", "_name", "_weekday", "_local_time", "_timezone"])) return null;
  const binding = bindWeeklyControlForReview("draft", { name: r._name, weekday: r._weekday,
    local_time: r._local_time, timezone: r._timezone }, { requestId: r._request_id as string });
  // Never silently normalize/substitute arguments after exact approval.
  return binding && Object.keys(r).every(key => r[key] === binding.args[key]) ? binding.args : null;
}

/** One native claim transport/response adapter, prepared for the incumbent Chat
 * claim-before-CAS branch. The original server must supply the selected stored
 * proposal, surface-approved token, caller JWT and authenticated runtime binding.
 * Shape checks do not authenticate or grant authority. Native SQL does that.
 * A claim only permits the existing Kit decision over returned stored args; it
 * does not save, enable or run work. No generic CAS fallback, commit, retry,
 * new confirmation, provider call, receipt or model tool is introduced here.
 */
export async function claimWeeklyDraftChatApproval(caller: Caller, options: ClaimOptions): Promise<ClaimResult> {
  let attempted = false;
  const fail = (): ClaimResult => ({ status: "unavailable", rpcAttempted: attempted,
    retryAllowed: false, genericFallbackAllowed: false });
  try {
    const p = dataRecord(options?.proposal), s = dataRecord(options?.scope), r = dataRecord(options?.runtime);
    const expected = p ? weeklyDraftNativeArgs(p.storedArgs) : null;
    if (!p || !s || !r || !expected || !closed(p, ["id", "approvedToken", "storedArgs"]) ||
      !closed(s, ["actorId", "tenantId", "threadId", "clientId"]) ||
      !closed(r, ["intentId", "requestNonce"]) || !uuid(p.id) ||
      !uuid(s.actorId) || !uuid(s.tenantId) || !uuid(s.threadId) || s.clientId !== null ||
      !uuid(r.intentId) || !uuid(r.requestNonce) || !uuid(options.confirmationRequestNonce) ||
      typeof p.approvedToken !== "string" || !/^[0-9a-f]{16}:[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(p.approvedToken) ||
      p.approvedToken.slice(17) === options.confirmationRequestNonce.toLowerCase() ||
      typeof options.current !== "function" || !options.signal || typeof options.signal.aborted !== "boolean" ||
      typeof caller?.rpc !== "function") return fail();
    const scope = Object.freeze({ actorId: s.actorId.toLowerCase(), tenantId: s.tenantId.toLowerCase(),
      threadId: s.threadId.toLowerCase() });
    const id = p.id.toLowerCase(), nonce = options.confirmationRequestNonce.toLowerCase();
    const args = Object.freeze({ _confirmation_id: id, _approved_token: p.approvedToken, _request_nonce: nonce,
      _expected_thread_id: scope.threadId, _intent_id: r.intentId.toLowerCase(),
      _runtime_request_nonce: r.requestNonce.toLowerCase() });
    const { current, signal } = options;
    const active = () => { try { return !signal.aborted && current() === true; } catch { return false; } };
    const stage = createWeeklyDraftDeadline(12_000, active);
    const reply = await stage(() => { attempted = true; return caller.rpc("claim_weekly_commitment_chat_draft", args); });
    if (!active() || !reply || reply.error !== null) return fail();
    const data = dataRecord(reply.data);
    if (!data || data.thread_id !== scope.threadId) return fail();
    const flags = { rpcAttempted: true, retryAllowed: false, genericFallbackAllowed: false } as const;
    if (data.claimed === true) {
      if (!closed(data, ["claimed", "confirmation_id", "actor_id", "tenant_id", "args", "thread_id"]) ||
        data.confirmation_id !== id || data.actor_id !== scope.actorId || data.tenant_id !== scope.tenantId) return fail();
      const stored = weeklyDraftNativeArgs(data.args);
      if (!stored || Object.keys(expected).some(key => expected[key] !== stored[key])) return fail();
      return { status: "claimed", storedArgs: stored, ...flags };
    }
    if (data.claimed !== false || !closed(data, ["claimed", "state", "thread_id"])) return fail();
    const state = parseWeeklyDraftState(data.state, scope);
    if (!state || state.confirmationId !== id || state.requestId.toLowerCase() !== String(expected._request_id).toLowerCase() ||
      !["saved", "saved_unreceipted", "changed", "declined", "unknown"].includes(state.phase) ||
      state.draft.name !== expected._name || state.draft.weekday !== expected._weekday ||
      state.draft.local_time !== expected._local_time || state.draft.timezone !== expected._timezone) return fail();
    const context = weeklyDraftModelContext(data.state, scope);
    return context ? { status: "observed", context, ...flags } : fail();
  } catch { return fail(); }
}
