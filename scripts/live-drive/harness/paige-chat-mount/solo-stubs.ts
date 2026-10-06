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

// ── C4c — a saved thread whose last answer is PAIGE's open question (askreload), and the same thread
// after the person answered and she carried on (askreload-answered). What bundle_ref holds.
const ASK_ID = "a5a5a5a5-1111-4222-8333-444444444444";
const ASK_QUESTION = "The Kestrel Group signed a 14-person engagement but didn't pick a start. Which start should I build?";
const ASK_OPTIONS = [
  { label: "Full kickoff", value: "full_kickoff", description: "90-minute workshop plus the intake form" },
  { label: "Light start", value: "light_start", description: "Intake form now, kickoff next month" },
  { label: "Mirror Lumen Freight", value: "mirror_lumen", description: "Copy the onboarding you ran for Lumen Freight" },
];
const ASK_TURNS = [
  { id: "k-u1", role: "user", content: "Set up onboarding for The Kestrel Group.", bundle_ref: null, created_at: at(30) },
  { id: "k-a1", role: "assistant", content: ASK_QUESTION, created_at: at(31), bundle_ref: {
    turn_state: { v: 1, state: "ASK_USER", mode: "clarify", rounds: 2, tools: 1, waiting_on: { kind: "choice" } },
    turn_trace: [{ label: "Read The Kestrel Group's agreement", group: "client", status: "done" }],
    paige_ask: { v: 1, ask_id: ASK_ID, question: ASK_QUESTION, options: ASK_OPTIONS, multi: false, allow_other: true, needs: "which start to build", objective: "Setting up The Kestrel Group's onboarding" },
  } },
];
const ASK_ANSWERED_TURNS = [
  ...ASK_TURNS,
  { id: "k-u2", role: "user", content: "Light start — intake form now, kickoff next month", created_at: at(33), bundle_ref: { paige_resume: { kind: "answer", key: `answer:${ASK_ID}`, from_turn_id: "5a5a5a5a-5a5a-4a5a-8a5a-5a5a5a5a5a5a" } } },
  { id: "k-a2", role: "assistant", content: "Got it — building the light start. The intake form is ready and linked in Kestrel's welcome email, which is waiting in your drafts.", created_at: at(34), bundle_ref: {
    turn_state: { v: 1, state: "FINAL", mode: "build", rounds: 2, tools: 2, resumed: { kind: "answer" } },
    turn_trace: [
      { label: "Created the intake form", group: "client", status: "done" },
      { label: "Linked it in Kestrel's welcome email", group: "client", status: "done" },
    ],
    paige_resume: { kind: "answer", from_turn_id: "5a5a5a5a-5a5a-4a5a-8a5a-5a5a5a5a5a5a", outcomes: [] },
  } },
];
// …and the same thread after an answer that never reached PAIGE (the request failed between the claim
// and her): she asked the SAME question again, under a new id that names the first (askreload-reopened).
const ASK_AGAIN_ID = "b6b6b6b6-1111-4222-8333-444444444444";
const ASK_REOPENED_TURNS = [
  ...ASK_TURNS,
  { id: "k-u2", role: "user", content: "Light start — intake form now, kickoff next month", created_at: at(33), bundle_ref: { paige_resume: { kind: "answer", key: `answer:${ASK_ID}`, from_turn_id: "5a5a5a5a-5a5a-4a5a-8a5a-5a5a5a5a5a5a" } } },
  { id: "k-a2", role: "assistant", content: `I couldn't carry on from your answer, so nothing was done with it yet.\n\n${ASK_QUESTION}`, created_at: at(34), bundle_ref: {
    turn_state: { v: 1, state: "ASK_USER", mode: "clarify", rounds: 0, tools: 0, waiting_on: { kind: "choice" } },
    paige_ask: { v: 1, ask_id: ASK_AGAIN_ID, question: ASK_QUESTION, options: ASK_OPTIONS, multi: false, allow_other: true, needs: "which start to build", objective: "Setting up The Kestrel Group's onboarding", reopens: ASK_ID },
  } },
];
// …and the same thread when the answer was claimed and nothing came back after it (the request died
// before PAIGE's reply was saved, or is still running): the composer stays bound to the question so a
// re-send names it (askreload-claimed).
const ASK_CLAIMED_TURNS = [
  ...ASK_TURNS,
  { id: "k-u2", role: "user", content: "Light start — intake form now, kickoff next month", created_at: at(33), bundle_ref: { paige_resume: { kind: "answer", key: `answer:${ASK_ID}`, from_turn_id: "5a5a5a5a-5a5a-4a5a-8a5a-5a5a5a5a5a5a" } } },
];
const ASK_THREAD = { ...THREAD, id: "harness-thread-kestrel", title: "Kestrel onboarding" };

// C4c — a file attached in the composer (?doc=1): while PAIGE's question is open the hint must say the
// file goes as a new message (a file is never an answer). The real hook's return shape, nothing read.
const HARNESS_DOC = params.get("doc") === "1"
  ? { file: new File(["%PDF-1.4"], "kestrel-agreement.pdf", { type: "application/pdf" }), name: "kestrel-agreement.pdf", kind: "pdf" as const, mimeType: "application/pdf", size: 1200, base64: "JVBERi0xLjQK" }
  : null;
export function useChatDocumentUpload() {
  return {
    attachedDoc: HARNESS_DOC, isProcessingFile: false, isDragOver: false, fileInputRef: { current: null }, acceptString: ".pdf,.png,.jpg,.jpeg,.webp,.docx",
    handleFileSelect: () => undefined, handleDragOver: () => undefined, handleDragLeave: () => undefined,
    handleDrop: () => undefined, removeAttachment: () => undefined, openFilePicker: () => undefined, setAttachedDoc: () => undefined,
  };
}

export function usePaigeThreads() {
  const threads = scenario === "reload" ? [THREAD] : scenario.startsWith("askreload") ? [ASK_THREAD] : [];
  return {
    threads,
    isLoading: false,
    isFetched: true,
    loadTurns: async () => (scenario === "reload" ? RELOAD_TURNS : scenario === "askreload" ? ASK_TURNS : scenario === "askreload-answered" ? ASK_ANSWERED_TURNS : scenario === "askreload-reopened" ? ASK_REOPENED_TURNS : scenario === "askreload-claimed" ? ASK_CLAIMED_TURNS : []),
    ensureThread: async () => "harness-thread-new",
    onTurnPersisted: () => undefined,
    renameThread: () => undefined,
    archiveThread: () => undefined,
    deleteThread: async () => undefined,
  };
}
export type PaigeThread = typeof THREAD;
