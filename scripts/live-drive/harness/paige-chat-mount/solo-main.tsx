// C3a — the Solo PAIGE chat (`PaigeAIChat`, the component SoloPaigeWorkspace and the tenant shell's
// PAIGE drawer both mount) rendered with its data hooks stubbed and the network answered in-page by
// SCRIPTED SSE frames: paige_turn (C1) and paige_step running/done/error (C2a/C2b), exactly the
// wire shapes the server emits. HARNESS RENDER · NOT LIVE: nothing here proves the deployed,
// signed-in app — that drive stays owed (§32/§70.1).
//
// ?scenario=fast|normal|research|approval|limit|interrupted|stop|refused|reload|first
// ?hold=<n>        stop the stream after n chunks and keep it open (a mid-turn frame)
// ?theme=light|dark  ?layout=page|drawer  (page = the Solo PAIGE workspace, drawer = the docked panel)
// ?resume=1        C4a: Approve is answered by a server that carried the approval forward
//                  (`paige_turn` resumed); ?followHold=<n> holds THAT follow-up after n chunks (frame a3)
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { PaigeAIChat } from "@/components/dashboard/PaigeAIChat";
import { Toaster } from "@/components/ui/toaster";
import "@/index.css";

const params = new URLSearchParams(window.location.search);
const theme = params.get("theme") === "dark" ? "dark" : "light";
const layout = params.get("layout") === "drawer" ? "drawer" : "page";
const scenario = params.get("scenario") ?? "normal";
const hold = params.has("hold") ? Number(params.get("hold")) : null;
const resume = params.get("resume") === "1";
const followHold = params.has("followHold") ? Number(params.get("followHold")) : null;
document.documentElement.classList.toggle("dark", theme === "dark");

type Chunk = { wait?: number; data: string };
const f = (payload: unknown, wait = 120): Chunk => ({ wait, data: `data: ${JSON.stringify(payload)}\n\n` });
const say = (text: string, wait = 60) => f({ choices: [{ delta: { content: text } }] }, wait);
const turn = (event: string, state: string, mode: string, wait = 80) => f({ paige_turn: { v: 1, event, state, mode } }, wait);
const step = (id: string, seq: number, label: string, status: string, detail?: string, wait = 260) =>
  f({ paige_step: { id, seq, round: 1, kind: "action", label, group: "owner", status, ...(detail ? { detail } : {}) } }, wait);
const thought = (label: string) => f({ paige_step: { id: "t:1", seq: 0, round: 1, kind: "thought", label, group: "owner" } }, 40);
const DONE: Chunk = { wait: 60, data: "data: [DONE]\n\n" };

const ACK = "I'll check your contacts, pipeline and open tasks for anyone who's gone quiet.";
const NORMAL_BODY = "\n\nThree clients haven't heard from you in over two weeks:\n\n- **Priya Natarajan** — 19 days. Her last touch was the session recap on Sept 16.\n- **The Kestrel Group** — 16 days, and they're mid-onboarding.\n- **Lumen Freight** — 15 days, though Maya's week-7 session is Thursday.\n\nPriya is the one I'd move on first, so I added a follow-up for Fri 10:00.";
const FP = "fp_7c1harness";

const scripts: Record<string, Chunk[]> = {
  fast: [turn("started", "WORKING", "pending"), turn("completed", "FINAL", "fast_answer", 900), say("Try this: **“Your next 90 days with Reyes & Co. — let's lock them in.”**\n\nWant a softer version too?"), DONE],
  normal: [
    turn("started", "WORKING", "pending"),
    thought("NOT-SHOWN-REASONING: I should check the CRM before the pipeline"),
    say(ACK, 300),
    step("a:1:0", 1, "Looking through your contacts", "running"),                                  // hold=4 → n2
    step("a:1:0", 1, "Looked through your contacts", "done", "41 contacts", 700),
    step("a:1:1", 2, "Reviewing your pipeline", "running"),                                        // hold=6 → n3
    step("a:1:1", 2, "Reviewed your pipeline", "done", "6 open engagements", 700),
    step("a:2:0", 3, "Checking your calendar for booked sessions", "error", "Calendar isn't connected — skipped"),
    step("a:2:1", 4, "Checking your tasks", "running"),                                            // hold=9 → n4
    step("a:2:1", 4, "Checked your tasks", "done", "3 open follow-ups", 700),
    step("a:3:0", 5, "Added a follow-up for Priya Natarajan", "done", "Task · Fri 10:00"),
    f({ paige_crm_result: { action: "task.create", outcome: "succeeded", receipt_recorded: true, readback: { title: "Follow up with Priya Natarajan", due_at: "Fri 10:00" }, record_locator: { record_id: "task-illustrative", deep_link_status: "unavailable" } } }),
    turn("completed", "FINAL", "action"),
    say(NORMAL_BODY.slice(0, 80), 200),                                                            // hold=14 → n5
    say(NORMAL_BODY.slice(80), 400),
    DONE,
  ],
  research: [
    turn("started", "WORKING", "pending"),
    say("I'll research this on the live web and bring back what holds up.", 200),
    step("a:1:0", 1, "Researching the live web", "running"),                                       // hold=3 → r1 / r2 (after 10s)
    step("a:1:0", 1, "Researched the live web", "done", "“Why do project-management rollouts stall at small architecture firms?”", 1200),
    f({ paige_research: {
      run_id: null, question: "Why do project-management rollouts stall at small architecture firms?", saved: true, configured: true,
      stop_reason: null, is_dossier: false, unverified_notes: [],
      findings: [
        { text: "Rollouts stall when the tool goes live before a shared project template exists. Firms under 20 people rarely have anyone whose job is to own that template.", confidence: "high", citations: [1, 3, 4] },
        { text: "Billable-hour pressure pushes setup work into evenings, so use drops after the first two weeks.", confidence: "medium", citations: [2, 5] },
        { text: "Firms that pilot on one live project first report steadier adoption than firm-wide launches.", confidence: "medium", citations: [3, 6] },
      ],
      sources: [1, 2, 3, 4, 5, 6, 7].map((n) => ({ index: n, url: `https://example.org/study-${n}`, title: `Illustrative source ${n}`, reliability: "medium", tier: null, published_at: null, excluded: false })),
    } }),
    turn("completed", "FINAL", "research"),
    say("\n\nThe short version: the tool is rarely the problem. Small firms stall because nobody owns the setup, and the setup competes with billable hours."),
    DONE,
  ],
  approval: [
    turn("started", "WORKING", "pending"),
    say("I'll pull the Q4 proposal and draft a short cover note.", 200),
    step("a:1:0", 1, "Found Daniel Reyes", "done", "Reyes & Co. Design Studio"),
    step("a:1:1", 2, "Found the Q4 retainer proposal", "done", "Updated Oct 1"),
    step("a:1:2", 3, "Drafting the cover note", "running"),                                        // hold=6 → a1
    step("a:1:2", 3, "Drafted the cover note", "done", "92 words", 900),
    f({ paige_confirm: { tool: "send_email", summary: "Send the renewal proposal to Daniel Reyes", fingerprint: FP } }),
    turn("waiting", "WAIT_APPROVAL", "action"),
    say("\n\nHere's what I'll send. Nothing goes out until you say so."),
    DONE,
  ],
  limit: [
    turn("started", "WORKING", "pending"),
    say("I'll review each client's session notes against their goals.", 200),
    ...["Priya Natarajan", "Daniel Reyes", "Maya Okafor", "The Kestrel Group", "Jordan Lee", "Sam Patel", "Ana Ruiz", "Ben Ortiz", "Lena Park"]
      .map((n, i) => step(`a:${i}`, i + 1, `Reviewed ${n}'s notes`, "done", undefined, 120)),
    step("a:9", 10, "Reviewing Noor Haddad's notes", "running"),                                   // hold=12 → l1
    step("a:9", 10, "Reviewing Noor Haddad's notes", "withdrawn", undefined, 400),
    turn("completed", "LIMIT_REACHED", "answer"),
    say("\n\nI reviewed 9 of 14 clients' session notes before this answer's limit. Two are drifting: **Priya Natarajan** (delegation goal, no progress in three sessions) and **The Kestrel Group** (intake still open). The other seven are on track."),
    DONE,
  ],
  interrupted: [
    turn("started", "WORKING", "pending"),
    say("I'll check each client's goals.", 200),
    ...["Priya Natarajan", "Daniel Reyes", "Maya Okafor", "The Kestrel Group"].map((n, i) => step(`a:${i}`, i + 1, `Reviewed ${n}'s notes`, "done", undefined, 120)),
    turn("completed", "INTERRUPTED", "answer"),
    say("\n\nSo far: **Priya Natarajan** is drifting on her delegation goal, and **The Kestrel Group** still has an open intake. I hit a snag finishing that — mind trying again?"),
    DONE,
  ],
  stop: [
    turn("started", "WORKING", "pending"),
    say(ACK, 200),
    step("a:1:0", 1, "Looked through your contacts", "done", "41 contacts"),
    step("a:1:1", 2, "Reviewing your pipeline", "running"),
    { wait: 3_600_000, data: "" },
  ],
  refused: [
    turn("started", "WORKING", "pending"),
    f({ client_scope: { status: "refused", kind: "permission", reason: "not_in_workspace" } }),
    turn("completed", "REFUSED", "pending"),
    say("I couldn't confirm that this client belongs to your workspace, so I'm not able to pull anything from their file or act on their record in this conversation. Nothing has been saved."),
    DONE,
  ],
};
const followUps: Record<string, Chunk[]> = {
  approved: [
    turn("started", "WORKING", "pending"),
    step("a:1:0", 1, "Sending to Daniel", "running"),
    step("a:1:0", 1, "Sent to Daniel", "done", "Sent 2:14 pm · logged on his timeline", 900),
    f({ paige_approval_outcome: { actions: [{ fingerprint: FP, outcome: "ran" }] } }),
    turn("completed", "FINAL", "action"),
    say("Sent, and it's on Daniel's timeline. If he hasn't opened it by Thursday, I'll bring it back to you."),
    DONE,
  ],
  declined: [turn("started", "WORKING", "pending"), turn("completed", "FINAL", "fast_answer", 300), say("Okay — it's not sent. The draft stays here if you change your mind."), DONE],
  // C4a — the same approval, carried forward by the server: it says `resumed`, runs the stored act
  // (the step), reports the card's outcome, and only then does PAIGE speak. followHold=3 → frame a3.
  resumed: [
    turn("started", "WORKING", "pending"),
    turn("resumed", "WORKING", "pending"),
    step("0:0:0:resume_fp_7c1harness", 1, "Sending to Daniel", "running"),
    step("0:0:0:resume_fp_7c1harness", 1, "Sent to Daniel", "done", "Sent 2:14 pm · logged on his timeline", 900),
    f({ paige_approval_outcome: { actions: [{ fingerprint: FP, outcome: "ran" }] } }),
    turn("completed", "FINAL", "action"),
    say("Sent, and it's on Daniel's timeline. If he hasn't opened it by Thursday, I'll bring it back to you."),
    DONE,
  ],
};

(window as unknown as { __c3: unknown }).__c3 = { requests: [] as unknown[] };
const realFetch = window.fetch.bind(window);
window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(input instanceof Request ? input.url : input);
  if (!url.includes("/functions/v1/paige-ai-chat")) return realFetch(input, init);
  const body = JSON.parse(String(init?.body ?? "{}"));
  const log = (window as unknown as { __c3: { requests: unknown[] } }).__c3.requests;
  log.push(body);
  const chunks = body.approvedConfirmations ? (resume ? followUps.resumed : followUps.approved) : body.declinedConfirmations ? followUps.declined : (scripts[scenario] ?? scripts.normal);
  const limit = log.length === 1 && hold !== null ? hold : log.length > 1 && followHold !== null ? followHold : chunks.length;
  const signal = init?.signal;
  return new Response(new ReadableStream<Uint8Array>({
    async start(controller) {
      const enc = new TextEncoder();
      for (let i = 0; i < chunks.length; i += 1) {
        if (i >= limit) return; // held open: a mid-turn frame
        await new Promise((r) => setTimeout(r, chunks[i].wait ?? 80));
        if (signal?.aborted) return;
        if (chunks[i].data) controller.enqueue(enc.encode(chunks[i].data));
      }
      controller.close();
    },
  }), { status: 200, headers: { "Content-Type": "text/event-stream" } });
};

const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
const css = document.createElement("style");
css.textContent = `
  html, body, #root { height: 100%; margin: 0; }
  .h-page { height: 100dvh; display: flex; flex-direction: column; background: var(--pg-canvas); }
  .h-cap { flex: none; font: 500 11px/1 system-ui; padding: 6px 12px; color: var(--pg-muted); border-bottom: 1px solid var(--pg-line-soft); }
  .h-body { flex: 1; min-height: 0; display: flex; }
  .h-work { flex: 1; min-width: 0; padding: 24px; color: var(--pg-muted); font: 13px/1.5 system-ui; }
  .h-drawer { flex: none; width: clamp(320px, 34vw, 520px); min-width: 0; border-left: 1px solid var(--pg-line); background: var(--pg-canvas); display: flex; flex-direction: column; }
  .h-full { flex: 1; min-width: 0; display: flex; flex-direction: column; }
  @media (max-width: 760px) { .h-work { display: none; } .h-drawer { width: 100%; border-left: 0; } }
`;
document.head.append(css);

function Harness() {
  const chat = layout === "drawer"
    ? <PaigeAIChat hideHeader fill enableHistory liveConversation={false} renderRail={() => null} />
    : <PaigeAIChat hideHeader fill enableHistory soloTenantSafety liveConversation={false} renderRail={() => null}
        greeting="What are we moving? Tell me the outcome, and I’ll show what I can read, draft, or ask you to approve." />;
  return (
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={["/solo/3855/paige"]}>
        <div data-pg={theme} data-tenant-shell className="h-page">
          <div className="h-cap" data-harness-cap>
            {layout === "drawer" ? "PAIGE open (docked panel, no Solo safety props)" : "PAIGE workspace (Solo page)"} · {scenario}{resume ? " · approval carried forward by the server" : ""}{hold !== null ? ` · held at ${hold}` : ""}{followHold !== null ? ` · follow-up held at ${followHold}` : ""} · {theme}
          </div>
          <div className="h-body">
            {layout === "drawer" ? (<><div className="h-work">Workspace content (illustrative)</div><aside className="h-drawer">{chat}</aside></>) : <div className="h-full">{chat}</div>}
          </div>
        </div>
        <Toaster />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

createRoot(document.getElementById("root")!).render(<Harness />);
