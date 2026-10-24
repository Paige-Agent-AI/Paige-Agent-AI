/**
 * PR7 — the first governed action, as one journey.
 *
 * The owner's directive (2026-10-24): "confirmed Setup edit → save → refresh → grounded
 * recommendation → explicit approval → original domain action → durable result and Rail
 * receipt → later return to that same result." For a coach or consultant, first value
 * means PAIGE helps accomplish useful authorized work and retains the result — not merely
 * completing an interview or offering advice.
 *
 * This file proves the CHAT half of that journey end to end through the public surface:
 * a grounded recommendation that carries a governed `planning.assign_task` proposal →
 * the explicit Approve press → the approved fingerprint on the wire to the canonical
 * runtime → the durable outcome narrated from the executor's report → and, after a full
 * remount (the reload the owner performs), the SAME proposal returned as a settled record
 * with no live approval to re-fire (§15) and the outcome still on the transcript.
 *
 * What deliberately stays OUTSIDE this file: the executor's own SQL (planning_writes
 * declares `plan_assign_task` LIVE with chat-canonical approval; the spine and
 * record_capability_run suites carry it), and the authenticated legs on the designated
 * ordinary account, which are the founder's single evaluation window.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ChatRailApi } from "./PaigeAIChat";

const harness = vi.hoisted(() => ({
  tenantId: "tenant-journey" as string | null,
  userId: "user-journey" as string | null,
  threads: [] as Array<{ id: string; title: string; updated_at: string }>,
  isFetched: true,
  rail: null as ChatRailApi | null,
  ensureThread: vi.fn(async () => "thread-plan"),
  loadTurns: vi.fn(async () => [] as Array<{ role: string; content: string; bundle_ref?: unknown }>),
}));

vi.mock("@tanstack/react-query", () => ({ useQuery: () => ({ data: null }) }));
vi.mock("@/hooks/useTenantContext", () => ({
  useTenantContext: () => ({ activeTenantId: harness.tenantId, activeTenant: { account_number: 42 } }),
}));
vi.mock("@/hooks/useScopedUserId", () => ({ useScopedUserId: () => harness.userId }));
vi.mock("@/lib/playbook", () => ({ usePlaybook: () => ({ persona: { name: "PAIGE" } }) }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock("@/components/voice/DictationMicButton", () => ({
  DictationMicButton: () => <button type="button" aria-label="Dictate">Dictate</button>,
}));
vi.mock("@/hooks/useChatDocumentUpload", () => ({
  useChatDocumentUpload: () => ({
    attachedDoc: null,
    isProcessingFile: false,
    isDragOver: false,
    fileInputRef: { current: null },
    acceptString: ".pdf",
    handleFileSelect: vi.fn(),
    handleDragOver: vi.fn(),
    handleDragLeave: vi.fn(),
    handleDrop: vi.fn(),
    removeAttachment: vi.fn(),
    openFilePicker: vi.fn(),
    setAttachedDoc: vi.fn(),
  }),
}));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { auth: { getSession: vi.fn(async () => ({ data: { session: { access_token: "test-token" } } })) } },
}));
vi.mock("@/hooks/usePaigeThreads", () => ({
  usePaigeThreads: () => ({
    threads: harness.threads,
    isLoading: false,
    isFetched: harness.isFetched,
    loadTurns: harness.loadTurns,
    ensureThread: harness.ensureThread,
    onTurnPersisted: vi.fn(),
    renameThread: vi.fn(),
    archiveThread: vi.fn(),
    deleteThread: vi.fn(),
  }),
}));
vi.mock("@/components/paige/live/PaigeLiveConversation", () => ({
  PaigeLiveConversation: () => <button aria-label="Start Live Conversation">Live</button>,
}));

import { PaigeAIChat } from "./PaigeAIChat";
import { setComposerDraftSessionScope } from "@/lib/paigeComposerScopeState";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const FINGERPRINT = "fp-assign-welcome-email-1";
const PROPOSAL_SUMMARY = "Add 'Draft your welcome email' to your plan and assign it to you";
const OUTCOME_TEXT = "Done — 'Draft your welcome email' is on your plan.";

const sse = (payload: unknown) => `data: ${JSON.stringify(payload)}\n\n`;
const proposalStream = () => new Response(
  sse({ choices: [{ delta: { content: "Here's where I'd start." } }] })
  + sse({ paige_confirm: {
    tool: "plan_assign_task",
    summary: PROPOSAL_SUMMARY,
    fingerprint: FINGERPRINT,
    command: { title: "Draft your welcome email", assignee: "owner" },
    idempotency_key: "idem-welcome-email-1",
  } })
  + sse({ choices: [{ delta: { content: "Approve it and I'll add the task." } }] })
  + "data: [DONE]\n\n",
  { status: 200, headers: { "Content-Type": "text/event-stream" } },
);
const outcomeStream = () => new Response(
  sse({ paige_approval_outcome: {
    actions: [{ fingerprint: FINGERPRINT, outcome: "ran" }],
  } })
  + sse({ choices: [{ delta: { content: OUTCOME_TEXT } }] })
  + "data: [DONE]\n\n",
  { status: 200, headers: { "Content-Type": "text/event-stream" } },
);

function setTextareaValue(textarea: HTMLTextAreaElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value")!.set!;
  setter.call(textarea, value);
  textarea.dispatchEvent(new Event("input", { bubbles: true }));
}

async function settle() {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe("PaigeAIChat first governed action journey (PR7)", () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    harness.tenantId = "tenant-journey";
    harness.userId = "user-journey";
    harness.threads = [];
    harness.isFetched = true;
    harness.rail = null;
    harness.ensureThread.mockReset();
    harness.ensureThread.mockResolvedValue("thread-plan");
    harness.loadTurns.mockReset();
    harness.loadTurns.mockResolvedValue([]);
    vi.stubGlobal("fetch", vi.fn(async () => outcomeStream()));
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
    setComposerDraftSessionScope({ kind: "clear" });
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  const render = async () => {
    await act(async () => {
      root.render(
        <PaigeAIChat
          hideHeader
          fill
          enableHistory
          soloTenantSafety
          liveConversation={false}
          renderRail={(api) => { harness.rail = api; return null; }}
        />,
      );
      await settle();
    });
  };
  const textarea = () => host.querySelector<HTMLTextAreaElement>("textarea")!;
  const send = () => host.querySelector<HTMLButtonElement>('button[aria-label="Send message"]')!;
  const type = async (value: string) => {
    await act(async () => setTextareaValue(textarea(), value));
  };
  const waitForWritable = async () => {
    for (let attempt = 0; attempt < 6 && textarea().disabled; attempt += 1) {
      await act(async () => { await settle(); });
    }
    expect(textarea().disabled).toBe(false);
  };
  const approveButton = () => Array.from(host.querySelectorAll("button"))
    .find((b) => (b.textContent ?? "").trim() === "Approve");
  const requestBody = (call: number) =>
    JSON.parse(String(((fetch as ReturnType<typeof vi.fn>).mock.calls[call][1] as RequestInit).body));

  it("grounds a recommendation, takes the explicit approval, and returns the settled result after reload", async () => {
    const fetchMock = vi.fn()
      .mockImplementationOnce(async () => proposalStream())
      .mockImplementationOnce(async () => outcomeStream());
    vi.stubGlobal("fetch", fetchMock);
    await render(); await waitForWritable();

    // 1 — the grounded recommendation carries the governed proposal on the canonical surface.
    await type("What should I focus on first?");
    await act(async () => { send().click(); await settle(); });
    expect(host.textContent).toContain("Here's where I'd start.");
    expect(host.textContent).toContain(PROPOSAL_SUMMARY);
    expect(approveButton()).toBeTruthy();

    // 2 — the explicit approval sends the card's exact fingerprint to the canonical runtime.
    await act(async () => { approveButton()!.click(); await settle(); });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const approvedBody = requestBody(1);
    expect(approvedBody.approvedConfirmations).toEqual([FINGERPRINT]);
    // The decision sentence the card sends on the person's behalf is on the wire; the transcript
    // shows the decided record in its place (the card, not a repeated sentence).
    const sentUserTurns = approvedBody.messages.filter((m: { role: string }) => m.role === "user");
    expect(sentUserTurns[sentUserTurns.length - 1].content).toContain("Approved — run it.");
    // The card they just decided is a record now — one approval, one execution.
    expect(approveButton()).toBeUndefined();
    expect(host.textContent).toContain("Approved");

    // 3 — the durable result is narrated from the executor's report, and the outcome card
    // settles to what the server actually said ran — never a guess.
    expect(host.textContent).toContain(OUTCOME_TEXT);
    expect(host.textContent).not.toContain("couldn't report back");

    // 4 — LATER RETURN: a full remount (the owner's reload) rehydrates the SAME proposal as a
    // settled record. §15 — a stored turn carries no live fingerprint, so nothing can re-fire a
    // decision already taken; the outcome stays on the transcript exactly as it was.
    await act(async () => { root.unmount(); });
    host.remove();
    harness.threads = [{ id: "thread-plan", title: "First value", updated_at: "2026-10-24T12:00:00Z" }];
    harness.loadTurns.mockResolvedValue([
      { role: "user", content: "What should I focus on first?" },
      { role: "assistant", content: "Here's where I'd start. Approve it and I'll add the task.", bundle_ref: {
        paige_confirm: [{ tool: "plan_assign_task", summary: PROPOSAL_SUMMARY, fingerprint: FINGERPRINT,
          command: { title: "Draft your welcome email", assignee: "owner" }, idempotency_key: "idem-welcome-email-1" }],
      } },
      { role: "user", content: "Approved — run it." },
      { role: "assistant", content: OUTCOME_TEXT },
    ]);
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    await render();
    for (let attempt = 0; attempt < 10 && !host.textContent?.includes(OUTCOME_TEXT); attempt += 1) {
      await act(async () => { await settle(); });
    }
    expect(host.textContent).toContain(PROPOSAL_SUMMARY);
    expect(host.textContent).toContain(OUTCOME_TEXT);
    expect(approveButton()).toBeUndefined();
    await waitForWritable();
  });
});
