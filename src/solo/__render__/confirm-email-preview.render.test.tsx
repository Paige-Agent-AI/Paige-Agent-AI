/**
 * INT-328 — drives the REAL Solo chat (`PaigeAIChat` with `soloTenantSafety`) with the frame the
 * chat server sends for `comms_send_email`, and proves the email preview travels the whole browser
 * path: `paige_confirm.preview` on the stream → the message's confirm item → the approval card's
 * envelope. Then (with a build present) it writes light and dark pages with the compiled Solo
 * tokens so the owner can SEE the card (§00); scripts/render/shoot-comms-email-send.mjs takes the
 * screenshots from those pages.
 *
 * PROOF CLASS, stated so it is never over-read: a RENDERED HARNESS — the real component tree, real
 * frames, real compiled CSS — with the network, the tenant and the session stubbed. It is not an
 * authenticated runtime drive of Solo, and it sends no email.
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

const FP = "c0ffee00c0ffee00";
// Synthetic people only: committed screenshots must never carry a real contact's name or address.
const SHORT_BODY = [
  "Hi Maya,",
  "",
  "Thanks for the time on Tuesday. Here is what we agreed: I'll send the revised scope by Thursday, you'll confirm the two site dates, and we start the week of the 14th.",
  "",
  "Talk soon,",
  "Jordan",
].join("\n");
const LONG_BODY = [
  "Hi Maya,",
  "",
  "Thanks again for walking me through the spring schedule. I've pulled together everything we covered so nothing gets lost between now and kickoff.",
  "",
  "First, the scope. We're keeping the front beds and the side yard in phase one, and moving the irrigation rework to phase two so the crew isn't waiting on parts.",
  "",
  "Second, timing. Your crew is free the week of the 14th. I'll hold that week for you until Thursday; after that I'll need to release it to the next client on the list.",
  "",
  "Third, the budget. Phase one comes in at the number we discussed. I'll send the written proposal tomorrow so you can share it with your partner before you sign.",
  "",
  "If anything here doesn't match what you remember, reply and I'll fix it before the proposal goes out.",
  "",
  "Talk soon,",
  "Jordan",
].join("\n");

const EMAIL = {
  tool: "comms_send_email",
  fingerprint: FP,
  summary: `Email Maya Ortiz at maya@ortizlandscaping.example from jordan@northlightadvisory.example: "Notes from Tuesday's planning call"`,
  // The exact frame shape paige-ai-chat writes: `preview` beside `command` (no `kind` needed).
  preview: {
    kind: "email",
    to_name: "Maya Ortiz",
    to_address: "maya@ortizlandscaping.example",
    from_address: "jordan@northlightadvisory.example",
    subject: "Notes from Tuesday's planning call",
    body_text: SHORT_BODY,
  },
};
const LONG = {
  ...EMAIL,
  summary: `Email Maya Ortiz at maya@ortizlandscaping.example from jordan@northlightadvisory.example: "Recap and next steps for the spring project"`,
  preview: { ...EMAIL.preview, subject: "Recap and next steps for the spring project", body_text: LONG_BODY },
};
const UNNAMED_LONG_ADDRESS = {
  ...EMAIL,
  summary: `Email accounts-payable.department.northeast-region@ortizlandscapingandgardenservices.example from jordan@northlightadvisory.example: "Invoice question"`,
  preview: {
    to_address: "accounts-payable.department.northeast-region@ortizlandscapingandgardenservices.example",
    from_address: "jordan@northlightadvisory.example",
    subject: "A quick question about the March statement",
    body_text: "Hello,\n\nCould you confirm which address the March statement should go to? I want to make sure it reaches the right person.\n\nThank you,\nJordan",
  },
};
const CONTACT = { tool: "crm_create_contact", summary: "Add Maya Ortiz at Ortiz Landscaping to your clients", fingerprint: FP };

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

type Scene = { label: string; note: string; ask: string; offer: string; proposal: Record<string, unknown>; expand?: boolean };

const SCENES: Scene[] = [
  {
    label: "An email, ready to approve",
    note: "The card shows the email itself: who it goes to, who it comes from, the subject and the words. Gold stays on Approve.",
    ask: "Send Maya a recap of Tuesday's call.",
    offer: "Here's the recap I'll send Maya. Nothing goes out until you approve.",
    proposal: EMAIL,
  },
  {
    label: "A long email",
    note: "Eight lines, then a soft fade and a way to read the rest. Approve never scrolls out of reach.",
    ask: "Send Maya the full recap and next steps.",
    offer: "Here's the full recap. Read it through before you approve.",
    proposal: LONG,
  },
  {
    label: "A long email, opened",
    note: "Opened, the body scrolls inside its own bounded area instead of pushing the card off the screen.",
    ask: "Send Maya the full recap and next steps.",
    offer: "Here's the full recap. Read it through before you approve.",
    proposal: LONG,
    expand: true,
  },
  {
    label: "No name on file, a very long address",
    note: "The address stands alone and breaks where it must, so it never runs off a phone screen.",
    ask: "Email their accounts team about the March statement.",
    offer: "Here's the note to their accounts team. Nothing goes out until you approve.",
    proposal: UNNAMED_LONG_ADDRESS,
  },
  {
    label: "Not an email — unchanged",
    note: "Any other approval reads exactly as it did before: the one sentence the server wrote.",
    ask: "Add Maya Ortiz at Ortiz Landscaping.",
    offer: "Here's the contact I'll add. Nothing is saved until you approve.",
    proposal: CONTACT,
  },
];

async function capture(scene: Scene): Promise<{ html: string; host: HTMLElement; cleanup: () => Promise<void> }> {
  vi.stubGlobal("fetch", vi.fn(async () => sse([say(scene.offer), frame({ paige_confirm: scene.proposal }), DONE])));
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
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
  if (scene.expand) {
    const toggle = Array.from(host.querySelectorAll("button")).find((b) => /Show full email/.test(b.textContent ?? ""))!;
    expect(toggle).toBeTruthy();
    await act(async () => { toggle.click(); await flush(); });
  }
  const transcript = host.querySelector("#solo-paige-transcript");
  expect(transcript).toBeTruthy();
  const messages = Array.from(transcript!.querySelectorAll("[data-paige-message-id]"));
  expect(messages.length).toBeGreaterThanOrEqual(2);
  return {
    html: messages.slice(-2).map((m) => m.outerHTML).join("\n"),
    host,
    cleanup: async () => {
      await act(async () => { root.unmount(); });
      host.remove();
      vi.unstubAllGlobals();
    },
  };
}

describe("the email preview travels the real Solo chat path", () => {
  it("a paige_confirm frame carrying preview renders the envelope on the live card", async () => {
    const run = await capture(SCENES[0]);
    try {
      const preview = run.host.querySelector("[data-confirm-preview='email']");
      expect(preview).toBeTruthy();
      const rows = Object.fromEntries(Array.from(preview!.querySelectorAll("dt")).map((dt) => [dt.textContent, dt.nextElementSibling?.textContent]));
      expect(rows.To).toContain("Maya Ortiz");
      expect(rows.To).toContain("maya@ortizlandscaping.example");
      expect(rows.From).toBe("jordan@northlightadvisory.example");
      expect(rows.Subject).toBe("Notes from Tuesday's planning call");
      expect(preview!.textContent).toContain("you'll confirm the two site dates");
      // The live card still asks for the decision, and Approve is still the act.
      expect(Array.from(run.host.querySelectorAll("button")).some((b) => (b.textContent ?? "").trim() === "Approve")).toBe(true);
    } finally {
      await run.cleanup();
    }
  });

  it("a frame with a malformed preview falls back to the server's sentence, never a half-envelope", async () => {
    const run = await capture({ ...SCENES[0], proposal: { ...EMAIL, preview: { ...EMAIL.preview, body_text: "" } } });
    try {
      expect(run.host.querySelector("[data-confirm-preview]")).toBeNull();
      expect(run.host.textContent).toContain(EMAIL.summary);
    } finally {
      await run.cleanup();
    }
  });

  it("a confirm frame without a preview renders exactly as before", async () => {
    const run = await capture(SCENES[4]);
    try {
      expect(run.host.querySelector("[data-confirm-preview]")).toBeNull();
      expect(run.host.textContent).toContain(CONTACT.summary);
    } finally {
      await run.cleanup();
    }
  });
});

function compiledCss(): string {
  const dir = "dist/assets";
  const files = readdirSync(dir).filter((f) => f.endsWith(".css"));
  const pick = ["main-", "SoloEntry-", "PaigeAIChat-"].map((p) => files.find((f) => f.startsWith(p))).filter(Boolean) as string[];
  return pick.map((f) => readFileSync(`${dir}/${f}`, "utf8")).join("\n");
}

function page(theme: "light" | "dark", scenes: Array<{ scene: Scene; html: string }>): string {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Email approval — ${theme}</title>
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
  @media (max-width: 480px) { .wrap { padding: 20px 12px 40px; } .frame { padding: 12px 10px; } }
</style></head>
<body data-pg="${theme}"><div class="wrap">
<header class="intro"><h1>Approving an email</h1>
<p>The real PAIGE chat from the Solo workspace, given the frame the server sends when Paige asks to email a client. ${theme === "dark" ? "Dark" : "Light"} theme. Nothing here sends an email.</p></header>
${scenes.map(({ scene, html }) => `<section class="scene" data-scene="${scene.label}"><h2>${scene.label}</h2><p>${scene.note}</p><div class="frame">${html}</div></section>`).join("\n")}
</div></body></html>`;
}

describe("email approval render harness", () => {
  // The pages embed the COMPILED tokens, so they need a build. CI runs tests without one; skip
  // rather than fail — this part is a viewing aid; the path assertions above always run.
  it.skipIf(!existsSync("dist/assets"))("writes the light and dark pages", async () => {
    const captured: Array<{ scene: Scene; html: string }> = [];
    for (const scene of SCENES) {
      const run = await capture(scene);
      captured.push({ scene, html: run.html });
      await run.cleanup();
    }
    // The pages inline ~900KB of compiled CSS, so they are build output, not evidence: they go to the
    // gitignored render-artifacts folder. scripts/render/shoot-comms-email-send.mjs screenshots them
    // into docs/evidence/ui-delivery/comms-email-send/ (the PNGs and render-results.json are tracked).
    const dir = "scripts/live-drive/artifacts/comms-email-send";
    mkdirSync(dir, { recursive: true });
    writeFileSync(`${dir}/confirm-email-preview.light.html`, page("light", captured), "utf8");
    writeFileSync(`${dir}/confirm-email-preview.dark.html`, page("dark", captured), "utf8");
  }, 60_000);
});
