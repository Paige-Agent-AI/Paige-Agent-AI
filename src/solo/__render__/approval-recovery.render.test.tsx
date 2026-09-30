/**
 * Drives the REAL Solo chat surface (`PaigeAIChat` with `soloTenantSafety`) into every state of the
 * approval recovery design, through real frames, and writes what it rendered into a page with the
 * compiled Solo tokens, light and dark, so the owner can SEE each state rather than read about it
 * (§00). `scripts/shoot-approval-recovery.mjs` screenshots the pages.
 *
 * PROOF CLASS, stated so it is never over-read: a RENDERED HARNESS — the real component tree, real
 * frames, real compiled CSS — with the network, the tenant and the session stubbed. It is not an
 * authenticated runtime drive of Solo; that is owed, and the evidence record says so.
 */
import { act } from "react";
import { createRoot } from "react-dom/client";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { PaigeAIChat } from "@/components/dashboard/PaigeAIChat";

vi.mock("@tanstack/react-query", () => ({ useQuery: () => ({ data: null }) }));
vi.mock("@/hooks/useTenantContext", () => ({
  useTenantContext: () => ({ activeTenantId: "account-a", activeTenant: { account_number: "3855" } }),
}));
vi.mock("@/hooks/useScopedUserId", () => ({ useScopedUserId: () => "owner-1" }));
vi.mock("@/lib/playbook", () => ({ usePlaybook: () => ({ persona: { name: "PAIGE" } }) }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock("@/components/voice/DictationMicButton", () => ({ DictationMicButton: () => null }));
vi.mock("@/hooks/useChatDocumentUpload", () => ({
  useChatDocumentUpload: () => ({
    attachedDoc: null, isDragOver: false, fileInputRef: { current: null }, acceptString: ".pdf",
    handleFileSelect: vi.fn(), handleDragOver: vi.fn(), handleDragLeave: vi.fn(), handleDrop: vi.fn(),
    removeAttachment: vi.fn(), openFilePicker: vi.fn(), setAttachedDoc: vi.fn(),
  }),
}));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { auth: { getSession: vi.fn(async () => ({ data: { session: { access_token: "test-token" } } })) } },
}));
vi.mock("@/hooks/usePaigeThreads", () => ({
  usePaigeThreads: () => ({
    threads: [], isLoading: false, isFetched: true,
    loadTurns: vi.fn(async () => []), ensureThread: vi.fn(async () => "thread-a"),
    onTurnPersisted: vi.fn(), renameThread: vi.fn(), archiveThread: vi.fn(), deleteThread: vi.fn(),
  }),
}));

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const FP_A = "aaaaaaaaaaaaaaaa";
const FP_B = "bbbbbbbbbbbbbbbb";
const DRAFTS = [
  { tool: "action_advance", summary: "Dismiss the draft “Following up on the Q3 proposal”", fingerprint: FP_A },
  { tool: "action_advance", summary: "Dismiss the draft “Checking in after the kickoff call”", fingerprint: FP_B },
];
// Synthetic people only: committed screenshots must never carry a real contact's name or address.
const CONTACT = [{
  tool: "crm_create_contact",
  summary: "Add Maya Ortiz at Ortiz Landscaping to your clients",
  fingerprint: FP_A,
}];
// The server's own sentence for this card (paige-ai-chat, calendar_link_send), with a synthetic address.
const BOOKING_LINK = [{
  tool: "calendar_link_send",
  summary: "Send the public booking link for Intro call to maya@ortizlandscaping.example by email. A real person receives a link to your /book page. The server refuses a calendar that isn't public and a recipient who can't be messaged; it does not post to social or book a meeting.",
  fingerprint: FP_A,
}];

const frame = (value: unknown) => `data: ${JSON.stringify(value)}\n\n`;
const say = (text: string) => frame({ choices: [{ delta: { content: text } }] });
const DONE = "data: [DONE]\n\n";
const sse = (frames: string[]) => ({
  ok: true, status: 200,
  body: {
    getReader() {
      let sent = false;
      return {
        async read() {
          if (sent) return { done: true, value: undefined };
          sent = true;
          return { done: false, value: new TextEncoder().encode(frames.join("")) };
        },
        releaseLock() {},
      };
    },
  },
});
const flush = async () => { for (let i = 0; i < 8; i += 1) await Promise.resolve(); };

type Scene = {
  label: string;
  note: string;
  ask: string;
  offer: string;
  proposal: typeof DRAFTS;
  /** What the approval turn returns; undefined leaves the card live, a pending promise leaves it running. */
  answer?: unknown;
  decline?: boolean;
};

const SCENES: Scene[] = [
  {
    label: "Needs your OK",
    note: "Unchanged. Gold is spent on Approve and nowhere else.",
    ask: "Clear out those two old follow-up drafts.",
    offer: "I found two drafts still waiting on your OK. I can dismiss both of them.",
    proposal: DRAFTS,
  },
  {
    label: "Running",
    note: "The moment Approve is pressed: the card that asked becomes a record, and this card says it is working.",
    ask: "Clear out those two old follow-up drafts.",
    offer: "I found two drafts still waiting on your OK. I can dismiss both of them.",
    proposal: DRAFTS,
    answer: new Promise(() => {}),
  },
  {
    label: "Done",
    note: "The contact the owner asked for, created. The receipt says Added.",
    ask: "Add Maya Ortiz at Ortiz Landscaping, 118 Birch Street, Austin, Texas 78704.",
    offer: "Here's the contact I'll add. Nothing is saved until you approve.",
    proposal: CONTACT,
    answer: sse([
      frame({ paige_approval_outcome: { actions: [{ fingerprint: FP_A, outcome: "ran" }] } }),
      frame({ paige_crm_result: { action: "contact.create", outcome: "succeeded", receipt_recorded: true,
        readback: { id: "c-1", client_ref: "Maya Ortiz" },
        record_locator: { record_id: "c-1", surface_url: "/solo/3855/clients/people", deep_link: "/solo/3855/clients/people?person=c-1", deep_link_status: "exact" } } }),
      say("Maya Ortiz is in your clients now."), DONE,
    ]),
  },
  {
    label: "Didn't run",
    note: "Said once, for the whole card. The next step is the one the screen can really do.",
    ask: "Clear out those two old follow-up drafts.",
    offer: "I found two drafts still waiting on your OK. I can dismiss both of them.",
    proposal: DRAFTS,
    answer: sse([
      frame({ paige_approval_outcome: {
        note: "Nothing changed. More than one approval was waiting, so Paige stopped rather than guess.",
        actions: [{ fingerprint: FP_A, outcome: "not_run" }, { fingerprint: FP_B, outcome: "not_run" }],
      } }),
      say("If you still want those cleared, ask me again."), DONE,
    ]),
  },
  {
    label: "Held back: internal details",
    note: "The approved message carried text only the platform uses, so it was not sent. The card says why, and the step is a rewrite.",
    ask: "Send Maya Ortiz the link to book an intro call.",
    offer: "Here's the booking link I'll send. Nothing goes out until you approve.",
    proposal: BOOKING_LINK,
    answer: sse([
      frame({ paige_approval_outcome: {
        note: "Nothing changed. The message included internal system details, so Paige stopped before it went out. Ask her to rewrite it.",
        actions: [{ fingerprint: FP_A, outcome: "not_run" }],
      } }),
      say("That message didn't go out. It had some of the platform's own wording in it. Want me to rewrite it in plain words for a fresh approval?"), DONE,
    ]),
  },
  {
    label: "One of two ran",
    note: "Each action says what happened to it. Asking again covers only the one that didn't run.",
    ask: "Clear out those two old follow-up drafts.",
    offer: "I found two drafts still waiting on your OK. I can dismiss both of them.",
    proposal: DRAFTS,
    answer: sse([
      frame({ paige_approval_outcome: { actions: [
        { fingerprint: FP_A, outcome: "ran" },
        { fingerprint: FP_B, outcome: "not_run", note: "It didn't go through." },
      ] } }),
      say("The first one is cleared. If you still want the other one cleared, ask me again."), DONE,
    ]),
  },
  {
    label: "One ran, one couldn't confirm",
    note: "The one that may have gone through says so on its own row, in amber, and nothing offers to ask again.",
    ask: "Clear out those two old follow-up drafts.",
    offer: "I found two drafts still waiting on your OK. I can dismiss both of them.",
    proposal: DRAFTS,
    answer: sse([
      frame({ paige_approval_outcome: { actions: [
        { fingerprint: FP_A, outcome: "ran" },
        { fingerprint: FP_B, outcome: "unconfirmed", note: "This may have gone through. Check before asking again, so it doesn't happen twice." },
      ] } }),
      say("The first one is cleared. I couldn't confirm the second, so check it before asking me again."), DONE,
    ]),
  },
  {
    label: "Couldn't confirm",
    note: "The answer never came back, so it may have worked. Amber, not red, and the step is to check first.",
    ask: "Add Maya Ortiz at Ortiz Landscaping, 118 Birch Street, Austin, Texas 78704.",
    offer: "Here's the contact I'll add. Nothing is saved until you approve.",
    proposal: CONTACT,
    answer: sse([
      frame({ paige_approval_outcome: {
        note: "This may have gone through. Check before asking again, so it doesn't happen twice.",
        actions: [{ fingerprint: FP_A, outcome: "unconfirmed" }],
      } }),
      say("I won't try it again on my own. Once you've checked, tell me what you'd like."), DONE,
    ]),
  },
  {
    label: "Connection lost",
    note: "The chat speaks for Paige, who never got to answer. Nothing is rolled back and nothing says the message wasn't sent.",
    ask: "Add Maya Ortiz at Ortiz Landscaping, 118 Birch Street, Austin, Texas 78704.",
    offer: "Here's the contact I'll add. Nothing is saved until you approve.",
    proposal: CONTACT,
    answer: sse([]),
  },
  {
    label: "Not now",
    note: "A decline leaves a record where the card was.",
    ask: "Clear out those two old follow-up drafts.",
    offer: "I found two drafts still waiting on your OK. I can dismiss both of them.",
    proposal: DRAFTS,
    decline: true,
    answer: sse([say("Okay. I've left both of them as they are."), DONE]),
  },
];

async function capture(scene: Scene): Promise<string> {
  let turn = 0;
  vi.stubGlobal("fetch", vi.fn(async () => {
    turn += 1;
    if (turn === 1) return sse([say(scene.offer), ...scene.proposal.map((c) => frame({ paige_confirm: c })), DONE]);
    return scene.answer;
  }));
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  try {
    // The props the Solo workspace mounts the chat with (SoloPaigeWorkspace.tsx), minus the
    // caller-owned rail and permissions chip, which sit outside the transcript captured here.
    await act(async () => {
      root.render(<PaigeAIChat hideHeader fill enableHistory soloTenantSafety greeting="What are we moving?" />);
      await flush();
    });
    const textarea = host.querySelector("textarea")!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value")!.set!.call(textarea, scene.ask);
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const send = Array.from(host.querySelectorAll("button")).find((b) => /send/i.test(b.getAttribute("aria-label") ?? ""))!;
    await act(async () => { send.click(); await flush(); });
    if (scene.answer !== undefined) {
      const control = Array.from(host.querySelectorAll("button"))
        .find((b) => (scene.decline ? /Not now/ : /^Approve/).test(b.textContent ?? ""))!;
      await act(async () => { control.click(); await flush(); });
    }
    const transcript = host.querySelector("#solo-paige-transcript");
    expect(transcript).toBeTruthy();
    // The greeting is the surface's, not this flow's: keep the frames to the exchange itself.
    const messages = Array.from(transcript!.querySelectorAll("[data-paige-message-id]"));
    // An empty capture must fail here, not ship as a screenshot of a blank frame.
    expect(messages.length).toBeGreaterThanOrEqual(2);
    return messages.slice(-4).map((m) => m.outerHTML).join("\n");
  } finally {
    await act(async () => { root.unmount(); });
    host.remove();
    vi.unstubAllGlobals();
  }
}

function compiledCss(): string {
  const dir = "dist/assets";
  const files = readdirSync(dir).filter((f) => f.endsWith(".css"));
  const pick = ["main-", "SoloEntry-", "PaigeAIChat-"].map((p) => files.find((f) => f.startsWith(p))).filter(Boolean) as string[];
  return pick.map((f) => readFileSync(`${dir}/${f}`, "utf8")).join("\n");
}

function page(theme: "light" | "dark", scenes: Array<{ scene: Scene; html: string }>): string {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Approval recovery — ${theme}</title>
<link href="https://fonts.googleapis.com/css2?family=Schibsted+Grotesk:ital,wght@0,400;0,500;0,600;0,700;1,400&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet" />
<style>${compiledCss()}</style>
<style>
  html, body { margin: 0; }
  body { background: var(--pg-env); color: var(--pg-ink); font-family: var(--pg-font-ui); }
  .wrap { max-width: 860px; margin: 0 auto; padding: 36px 20px 56px; display: grid; gap: 30px; }
  .intro h1 { font-family: var(--pg-font-display); font-size: 21px; letter-spacing: -0.02em; margin: 0 0 6px; }
  .intro p, .scene > p { color: var(--pg-muted); font-size: 13px; line-height: 1.55; margin: 0; max-width: 68ch; }
  .scene h2 { font-family: var(--pg-font-display); font-size: 16px; letter-spacing: -0.01em; margin: 0 0 3px; }
  .scene > p { margin-bottom: 10px; }
  .frame { background: var(--pg-canvas); border: 1px solid var(--pg-line); border-radius: 14px; padding: 18px 16px; display: grid; gap: 16px; }
</style></head>
<body data-pg="${theme}"><div class="wrap">
<header class="intro"><h1>When an approval doesn't go through</h1>
<p>The real PAIGE chat from the Solo workspace, driven through each state by the frames the server sends. ${theme === "dark" ? "Dark" : "Light"} theme.</p></header>
${scenes.map(({ scene, html }) => `<section class="scene" data-scene="${scene.label}"><h2>${scene.label}</h2><p>${scene.note}</p><div class="frame">${html}</div></section>`).join("\n")}
</div></body></html>`;
}

describe("approval recovery render harness", () => {
  // The pages embed the COMPILED tokens, so they need a build. CI runs tests without one; skip
  // rather than fail, because this harness is a viewing aid, not a correctness gate.
  it.skipIf(!existsSync("dist/assets"))("drives the real surface into every state and writes the pages", async () => {
    const captured: Array<{ scene: Scene; html: string }> = [];
    for (const scene of SCENES) captured.push({ scene, html: await capture(scene) });
    const dir = "docs/evidence/ui-delivery/solo-approval-recovery";
    mkdirSync(dir, { recursive: true });
    writeFileSync(`${dir}/approval-recovery.light.html`, page("light", captured), "utf8");
    writeFileSync(`${dir}/approval-recovery.dark.html`, page("dark", captured), "utf8");
  }, 60_000);
});
