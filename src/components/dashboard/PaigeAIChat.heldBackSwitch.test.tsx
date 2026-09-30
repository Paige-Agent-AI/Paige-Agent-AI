/**
 * R2: the held-back approval card belongs to the workspace it was drafted in. The Solo chat is driven
 * through a real held-back turn (the booking-link card approved, the server's `internal_text` outcome),
 * then the active workspace switches WITHOUT a remount — the harder case, since SoloApp also remounts
 * the workspace per account. Nothing of the first workspace's card or its sentence may show in the second.
 *
 * PROOF CLASS: behavioral, jsdom, the real `PaigeAIChat` with `soloTenantSafety`; the network, tenant and
 * session are stubbed. Not an authenticated runtime drive.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PaigeAIChat } from "@/components/dashboard/PaigeAIChat";
import { APPROVAL_OUTCOME_SENTENCES } from "../../../supabase/functions/_shared/approval-outcome";

const harness = vi.hoisted(() => ({ tenantId: "account-a", accountNumber: "3855" }));

vi.mock("@tanstack/react-query", () => ({ useQuery: () => ({ data: null }) }));
vi.mock("@/hooks/useTenantContext", () => ({
  useTenantContext: () => ({ activeTenantId: harness.tenantId, activeTenant: { account_number: harness.accountNumber } }),
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

// The server's own sentence for this outcome, taken from its closed set rather than typed here.
const NOTE = [...APPROVAL_OUTCOME_SENTENCES].find((sentence) => sentence.includes("The message included internal system details"))!;
// A synthetic recipient only.
const PROPOSAL = {
  tool: "calendar_link_send",
  summary: "Send the public booking link for Intro call to maya@ortizlandscaping.example by email.",
  fingerprint: "aaaaaaaaaaaaaaaa",
};
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

let host: HTMLDivElement | null = null;
let root: Root | null = null;

async function render() {
  await act(async () => {
    root!.render(<PaigeAIChat hideHeader fill enableHistory soloTenantSafety greeting="What are we moving?" />);
    await flush();
  });
}

const reportCard = () => host!.querySelector('[data-card-mode="report"]');

afterEach(async () => {
  if (root) await act(async () => { root!.unmount(); });
  host?.remove();
  host = null;
  root = null;
  harness.tenantId = "account-a";
  harness.accountNumber = "3855";
  vi.unstubAllGlobals();
});

describe("the held-back approval card across a workspace switch", () => {
  it("shows in the workspace it was drafted in, and nothing of it shows in the next", async () => {
    let turn = 0;
    vi.stubGlobal("fetch", vi.fn(async () => {
      turn += 1;
      if (turn === 1) return sse([say("Here's the booking link I'll send."), frame({ paige_confirm: PROPOSAL }), DONE]);
      return sse([
        frame({ paige_approval_outcome: { note: NOTE, actions: [{ fingerprint: PROPOSAL.fingerprint, outcome: "not_run" }] } }),
        say("That message didn't go out. Want me to rewrite it for a fresh approval?"), DONE,
      ]);
    }));
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    await render();

    const textarea = host.querySelector("textarea")!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value")!.set!.call(textarea, "Send Maya Ortiz the link to book an intro call.");
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const send = Array.from(host.querySelectorAll("button")).find((b) => /send/i.test(b.getAttribute("aria-label") ?? ""))!;
    await act(async () => { send.click(); await flush(); });
    const approve = Array.from(host.querySelectorAll("button")).find((b) => /^Approve/.test(b.textContent ?? ""))!;
    await act(async () => { approve.click(); await flush(); });

    // In its own workspace: the held-back card, its sentence and its one next step.
    expect(reportCard()?.getAttribute("data-state")).toBe("failed");
    expect(host.textContent).toContain(NOTE);
    expect(host.textContent).toContain("Ask Paige again");

    // The owner switches to another Solo workspace, same mounted chat.
    harness.tenantId = "account-b";
    harness.accountNumber = "4120";
    await render();

    expect(reportCard()).toBeNull();
    expect(host.querySelector("[data-card-mode]")).toBeNull();
    expect(host.textContent).not.toContain(NOTE);
    expect(host.textContent).not.toContain("maya@ortizlandscaping.example");
    expect(host.textContent).not.toContain("Ask Paige again");
    expect(host.textContent).toContain("What are we moving?");
  });
});
