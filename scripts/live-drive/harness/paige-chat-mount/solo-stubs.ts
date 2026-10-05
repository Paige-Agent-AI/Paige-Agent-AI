// C3a — stubs for the Solo PAIGE chat (`PaigeAIChat`) mount. Each export mirrors the real hook's
// return shape; nothing here reaches a network. The chat itself, its cards, the status line and the
// stylesheets are the real ones. Thread fixtures are VISIBLY illustrative (Brightwater Advisory is
// an invented business; no real account appears here — CLAUDE.md §63).
import { useMemo } from "react";

const params = new URLSearchParams(window.location.search);
const scenario = params.get("scenario") ?? "normal";

export const supabase = {
  auth: {
    getSession: async () => ({ data: { session: { access_token: "harness-token", user: { id: "harness-owner" } } } }),
    getUser: async () => ({ data: { user: { id: "harness-owner" } }, error: null }),
    onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
  },
  functions: { invoke: async () => ({ data: null, error: null }) },
  from: () => {
    const chain: Record<string, unknown> = {};
    for (const k of ["select", "eq", "neq", "in", "is", "order", "limit", "gte", "lte", "match", "or"]) chain[k] = () => chain;
    chain.maybeSingle = async () => ({ data: null, error: null });
    chain.single = async () => ({ data: null, error: null });
    chain.then = (resolve: (v: unknown) => unknown) => resolve({ data: [], error: null });
    return chain;
  },
  rpc: async () => ({ data: null, error: null }),
  channel: () => ({ on() { return this; }, subscribe() { return this; } }),
  removeChannel: () => undefined,
  storage: { from: () => ({ createSignedUrl: async () => ({ data: null, error: null }) }) },
};

export function useTenantContext() {
  return useMemo(() => ({
    activeTenantId: "harness-tenant",
    activeTenant: { id: "harness-tenant", name: "Brightwater Advisory", account_number: "3855", account_type: "solo" },
    tenants: [],
    isLoading: false,
  }), []);
}
export const TenantProvider = ({ children }: { children: unknown }) => children;

export function useScopedUserId() { return "harness-owner"; }

export function usePlaybook() {
  return { persona: { name: "PAIGE", greeting: "", role: "" }, quickActions: [] };
}

// ── Saved-thread fixture for the reload frame (o1): what bundle_ref.turn_state + turn_trace hold. ──
const at = (m: number) => new Date(Date.UTC(2026, 9, 4, 14, m)).toISOString();
const RELOAD_TURNS = [
  { id: "r-u1", role: "user", content: "Who hasn't heard from us in two weeks?", bundle_ref: null, created_at: at(0) },
  { id: "r-a1", role: "assistant", content: "Three clients haven't heard from you in over two weeks: Priya Natarajan, The Kestrel Group and Lumen Freight.", created_at: at(1), bundle_ref: {
    turn_state: { v: 1, state: "FINAL", mode: "action", rounds: 3, tools: 5 },
    turn_trace: [
      { label: "Looked through your contacts", group: "owner", status: "done" },
      { label: "Reviewed your pipeline", group: "owner", status: "done" },
      { label: "Checked your calendar for booked sessions", group: "owner", status: "error" },
      { label: "Checked your tasks", group: "owner", status: "done" },
      { label: "Added a follow-up for Priya Natarajan", group: "owner", status: "done" },
    ],
  } },
  { id: "r-u2", role: "user", content: "Send the renewal proposal to Daniel Reyes.", bundle_ref: null, created_at: at(5) },
  { id: "r-a2", role: "assistant", content: "Here's what I'll send. Nothing goes out until you say so.", created_at: at(6), bundle_ref: {
    paige_confirm: [{ tool: "send_email", summary: "Send the renewal proposal to Daniel Reyes" }],
    turn_state: { v: 1, state: "WAIT_APPROVAL", mode: "action", rounds: 2, tools: 3, waiting_on: { kind: "approval", approvals: 1 } },
    turn_trace: [
      { label: "Found Daniel Reyes", group: "owner", status: "done" },
      { label: "Found the Q4 retainer proposal", group: "owner", status: "done" },
      { label: "Drafted the cover note", group: "owner", status: "done" },
    ],
  } },
  { id: "r-u3", role: "user", content: "Approved — run it.", bundle_ref: null, created_at: at(14) },
  { id: "r-a3", role: "assistant", content: "Sent, and it's on Daniel's timeline.", created_at: at(15), bundle_ref: { turn_state: { v: 1, state: "FINAL", mode: "fast_answer", rounds: 1, tools: 0 } } },
  { id: "r-u4", role: "user", content: "Pull last quarter's session counts for every client.", bundle_ref: null, created_at: at(20) },
  { id: "r-a4", role: "assistant", content: "", created_at: at(21), bundle_ref: {
    turn_state: { v: 1, state: "WORKING", mode: "pending", rounds: 1, tools: 1 },
    turn_trace: [{ label: "Counted sessions by client", group: "owner", status: "done" }],
  } },
];

const THREAD = { id: "harness-thread", title: "Quiet clients", last_message_at: at(21), message_count: 8, is_archived: false, updated_at: at(21) };

export function usePaigeThreads() {
  const threads = scenario === "reload" ? [THREAD] : [];
  return {
    threads,
    isLoading: false,
    isFetched: true,
    loadTurns: async () => (scenario === "reload" ? RELOAD_TURNS : []),
    ensureThread: async () => "harness-thread-new",
    onTurnPersisted: () => undefined,
    renameThread: () => undefined,
    archiveThread: () => undefined,
    deleteThread: async () => undefined,
  };
}
export type PaigeThread = typeof THREAD;
