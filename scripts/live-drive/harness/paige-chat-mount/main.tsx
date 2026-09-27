import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { PaigeChat } from "@/components/app/PaigeChat";
// The sentence is the shipped one, read from the server module itself, never a copy typed here.
import { syncStatusForClient, WITHHELD_FRAME, withheldReplyForClient } from "../../../../supabase/functions/_shared/client-seat-reply.ts";
import "@/index.css";

// ?theme=light|dark · ?variant=withheld|saved|answer|syncfail|syncpartial|syncfail-before · ?doc=1 (an attached document)
const params = new URLSearchParams(window.location.search);
const theme = params.get("theme") === "light" ? "light" : "dark";
const variant = params.get("variant") ?? "withheld";
document.documentElement.classList.toggle("dark", theme === "dark");
document.documentElement.setAttribute("data-theme", theme);

const BUSINESS = "Northside Fitness";
const ANSWER = "Got it. Your next session is Tuesday at 10am with Sam, and your plan has two sessions left this month. Want me to book the next one?";
const frame = (payload: unknown) => `data: ${JSON.stringify(payload)}\n\n`;
const stream = (text: string) => new Response(new ReadableStream<Uint8Array>({
  start(controller) {
    // Two chunks, as a real stream arrives, so the chat's line buffering is exercised.
    const bytes = new TextEncoder().encode(text);
    const half = Math.floor(bytes.length / 2);
    controller.enqueue(bytes.slice(0, half));
    setTimeout(() => { controller.enqueue(bytes.slice(half)); controller.close(); }, 150);
  },
}), { status: 200, headers: { "Content-Type": "text/event-stream" } });

// The portal chat calls one endpoint, twice: once to greet, once per message. Answered in-page.
const realFetch = window.fetch.bind(window);
window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(input instanceof Request ? input.url : input);
  if (!url.includes("/functions/v1/paige-ai-chat")) return realFetch(input, init);
  const body = JSON.parse(String(init?.body ?? "{}"));
  const isGreeting = !body.document && Array.isArray(body.messages) && body.messages.length === 1 && !("sessionDocumentContext" in body);
  if (isGreeting) return stream(frame({ choices: [{ delta: { content: "Good morning, Jordan. What can I help you with today?" } }] }) + "data: [DONE]\n\n");
  if (variant === "answer") return stream(frame({ choices: [{ delta: { content: ANSWER } }] }) + "data: [DONE]\n\n");
  // A credit report whose sync did not complete (R3b): what the pipeline used to send, and what the
  // uploader reads now, the sentence taken from the server module itself.
  // `syncpartial` is a sync that stopped after its first write (a refused upload stamp).
  if (variant === "syncfail" || variant === "syncpartial" || variant === "syncfail-before") {
    const failed = variant === "syncpartial"
      ? { success: false, error: "That could not be saved", step: "write_rejected", write: "credit_report_uploads" }
      : { success: false, error: "Failed to parse extracted data", step: "extraction_parse" };
    const sync = variant === "syncfail-before" ? failed : syncStatusForClient(failed, BUSINESS);
    return stream(frame({ choices: [{ delta: { content: "Got it — I've read through your credit report. It's a tri-merge from all three bureaus, and I can see your scores and the accounts listed on each." } }] }) + frame({ sync_status: sync }) + "data: [DONE]\n\n");
  }
  const sentence = withheldReplyForClient(BUSINESS, { savedSomething: variant === "saved" });
  return stream(WITHHELD_FRAME + frame({ choices: [{ delta: { content: sentence } }] }) + "data: [DONE]\n\n");
};

const queryClient = new QueryClient();
const user = { id: "harness-client", email: "jordan@example.test", user_metadata: { first_name: "Jordan" } } as never;

// AppShell's frame on /app: the chat panel at 40% beside the dashboard on desktop, full width on a
// phone (the dashboard panel is hidden below `md`, 768px). Written as plain CSS: Tailwind does not
// scan harness files, so arbitrary classes here would silently not exist.
const frameCss = document.createElement("style");
frameCss.textContent = `
  .harness-chat { flex: 1 1 100%; min-width: 0; height: 100%; }
  .harness-dash { display: none; }
  @media (min-width: 768px) {
    .harness-chat { flex: 0 0 40%; }
    .harness-dash { display: block; flex: 1 1 auto; }
  }`;
document.head.append(frameCss);

function Harness() {
  return (
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={["/app"]}>
        <div className="h-dvh flex flex-col bg-background overflow-x-hidden">
          <div className="h-12 shrink-0 border-b border-border flex items-center px-4 text-sm text-muted-foreground">Client portal · harness render, not live</div>
          <div className="flex flex-1 min-h-0">
            <div className="harness-chat">
              <PaigeChat user={user} session={null} />
            </div>
            <div className="harness-dash border-l border-border p-6 text-sm text-muted-foreground">Dashboard</div>
          </div>
        </div>
      </MemoryRouter>
    </QueryClientProvider>
  );
}
createRoot(document.getElementById("root")!).render(<Harness />);
