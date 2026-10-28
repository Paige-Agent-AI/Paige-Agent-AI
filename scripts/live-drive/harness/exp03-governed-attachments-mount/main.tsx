// EXP03 governed attachments — the Solo PAIGE chat answering "send it with the files" with the approval card
// the server writes for comms_send_email. HARNESS RENDER · SYNTHETIC DATA · NOT LIVE: every name, address and
// file is fictional (Brightwater Advisory, Maya Ortiz, Ortiz Landscaping). The signed-in Solo chat and a real
// send are owed (§32/§70.1).
//
// The confirm frame is the shape comms-email-command hands paige-ai-chat (preview beside the call): `preview`
// carries to/from/subject/body and, new in this change, `attachments: [{ name, size, mime }]` — the files as the
// server read and fingerprinted them (never a storage path). The browser's own gate (parseConfirmPreview) and
// the card (PaigeConfirmCard) are NOT stubbed.
//   ?files=0   control: an email with no files (no File row)
//   ?files=1   one PDF
//   ?files=3   three files, one with a very long name
//   ?files=10  ten files (the most a card accepts)
//   ?theme=light|dark  ?layout=dock|phone (dock = the shell's real .tcs-paige column at minmax(340px, 26vw); phone =
//   full width with the same .tcs-paige-body surface). HARNESS DIVERGENCE: Solo wraps the chat in SoloPaigeWorkspace
//   (its tab strip and chat head); that wrapper is not mounted here, so the card sits a few px wider than in the app.
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { PaigeAIChat } from "@/components/dashboard/PaigeAIChat";
import { Toaster } from "@/components/ui/toaster";
import "@/index.css";
import "../portal-access-mount/fonts.css";
import "@/components/tenant-shell/tenant-command-center-shell.css";

const params = new URLSearchParams(window.location.search);
const theme = params.get("theme") === "dark" ? "dark" : "light";
const files = Number(params.get("files") ?? "1");
const layout = params.get("layout") === "phone" ? "phone" : "dock";
document.documentElement.classList.toggle("dark", theme === "dark");

const FILE_SETS: Record<number, Array<{ name: string; size: number; mime: string }>> = {
  0: [],
  1: [{ name: "Spring-planting-proposal.pdf", size: 2_516_582, mime: "application/pdf" }],
  3: [
    { name: "Spring-planting-proposal.pdf", size: 2_516_582, mime: "application/pdf" },
    { name: "Ortiz-Landscaping_front-and-side-yard_site-plan_revision-4_FINAL_approved-by-Maya_2026-10-27.pdf", size: 7_864_320, mime: "application/pdf" },
    { name: "Plant list.xlsx", size: 49_152, mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" },
  ],
  10: [
    { name: "Spring-planting-proposal.pdf", size: 2_516_582, mime: "application/pdf" },
    { name: "Site plan — revision 4.pdf", size: 7_864_320, mime: "application/pdf" },
    { name: "Plant list.xlsx", size: 49_152, mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" },
    { name: "Front bed — before.jpg", size: 3_355_443, mime: "image/jpeg" },
    { name: "Side yard — before.jpg", size: 2_936_013, mime: "image/jpeg" },
    { name: "Irrigation notes.docx", size: 88_064, mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" },
    { name: "Crew schedule.pdf", size: 312_320, mime: "application/pdf" },
    { name: "Soil test results.pdf", size: 1_153_434, mime: "application/pdf" },
    { name: "Warranty terms.pdf", size: 96_256, mime: "application/pdf" },
    { name: "readme.txt", size: 820, mime: "text/plain" },
  ],
};
const attachments = FILE_SETS[files] ?? FILE_SETS[1];
const FP = "c0ffee00c0ffee01";
const BODY = [
  "Hi Maya,",
  "",
  attachments.length ? `Attached ${attachments.length === 1 ? "is the proposal" : "are the proposal and the supporting files"} we talked through on Tuesday. The plan keeps the front beds and the side yard in phase one.` : "Thanks for the time on Tuesday. I'll send the proposal once the site plan is final.",
  "",
  "Talk soon,",
  "Jordan",
].join("\n");
// commsEmailAttachmentSummary (supabase/functions/_shared/comms-email/attachments.ts): " — with N files: a, b, c".
const fileWords = attachments.length === 0 ? "" : ` — with ${attachments.length === 1 ? "1 file" : `${attachments.length} files`}: ${attachments.map((e) => e.name).join(", ")}`;
const CONFIRM = {
  tool: "comms_send_email",
  fingerprint: FP,
  summary: `Email Maya Ortiz at maya@ortizlandscaping.example from jordan@brightwateradvisory.example: "Spring proposal and site plan"` + fileWords,
  preview: {
    kind: "email",
    to_name: "Maya Ortiz",
    to_address: "maya@ortizlandscaping.example",
    from_address: "jordan@brightwateradvisory.example",
    subject: "Spring proposal and site plan",
    body_text: BODY,
    ...(attachments.length ? { attachments } : {}),
  },
};

const frame = (payload: unknown) => `data: ${JSON.stringify(payload)}\n\n`;
const CHUNKS = [
  frame({ paige_turn: { v: 1, event: "started", state: "WORKING", mode: "pending" } }),
  frame({ choices: [{ delta: { content: "Here's the email to Maya. Nothing goes out until you approve." } }] }),
  frame({ paige_confirm: CONFIRM }),
  frame({ paige_turn: { v: 1, event: "waiting", state: "WAIT_APPROVAL", mode: "action" } }),
  "data: [DONE]\n\n",
];
(window as unknown as { __exp03a: { requests: unknown[] } }).__exp03a = { requests: [] };
const realFetch = window.fetch.bind(window);
window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(input instanceof Request ? input.url : input);
  if (!url.includes("/functions/v1/paige-ai-chat")) return realFetch(input, init);
  (window as unknown as { __exp03a: { requests: unknown[] } }).__exp03a.requests.push(JSON.parse(String(init?.body ?? "{}")));
  return new Response(new ReadableStream<Uint8Array>({
    async start(controller) {
      const enc = new TextEncoder();
      for (const c of CHUNKS) { await new Promise((r) => setTimeout(r, 60)); controller.enqueue(enc.encode(c)); }
      controller.close();
    },
  }), { status: 200, headers: { "Content-Type": "text/event-stream" } });
};

const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
const css = document.createElement("style");
css.textContent = `
  html, body, #root { height: 100%; margin: 0; }
  .h-page { height: 100dvh; display: flex; background: var(--pg-canvas); }
  .h-work { flex: 1; min-width: 0; padding: 24px; color: var(--pg-muted); font: 13px/1.5 system-ui; }
  /* The real .tcs-paige column + .tcs-paige-body (padding 0, as Solo's portalled workspace sets it); the shell's
     grid gives the column --tcs-paige: minmax(340px, 26vw), reproduced here as a fixed width. */
  .h-dock { flex: none; width: max(340px, 26vw); }
  .h-phone { flex: 1; min-width: 0; display: flex; flex-direction: column; }
`;
document.head.append(css);

function Harness() {
  const chat = <PaigeAIChat hideHeader fill enableHistory soloTenantSafety liveConversation={false} renderRail={() => null} />;
  return (
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={["/solo/3855/paige"]}>
        <div data-pg={theme} data-tenant-shell className="h-page">
          {layout === "dock"
            ? (<><div className="h-work">Workspace content (illustrative)</div><aside className="tcs-paige h-dock" aria-label="PAIGE"><div className="tcs-paige-body" style={{ padding: 0, display: "flex", flexDirection: "column" }}>{chat}</div></aside></>)
            : <div className="h-phone tcs-paige-body" style={{ padding: 0 }}>{chat}</div>}
        </div>
        <Toaster />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

createRoot(document.getElementById("root")!).render(<Harness />);
