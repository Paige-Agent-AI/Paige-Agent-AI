import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { PaigeAIChat } from "@/components/dashboard/PaigeAIChat";
import { createComposerRequestFence } from "@/lib/paigeComposerScopeState";
import { SoloPaigeWorkspace } from "./SoloPaigeWorkspace";

function visibleTranscriptGeometry(transcript: HTMLDivElement) {
  transcript.getBoundingClientRect = () => ({ top: 0, bottom: 300, left: 0, right: 600, width: 600, height: 300, x: 0, y: 0, toJSON: () => ({}) });
  transcript.querySelectorAll<HTMLElement>("[data-paige-message-id]").forEach((item, index) => {
    item.getBoundingClientRect = () => {
      const top = index * 1200 - transcript.scrollTop;
      return { top, bottom: top + 1200, left: 0, right: 600, width: 600, height: 1200, x: 0, y: top, toJSON: () => ({}) };
    };
  });
}

const chatHarness = vi.hoisted(() => ({
  tenantId: "account-a" as string | null,
  loadTurns: vi.fn(),
  ensureThread: vi.fn(),
  dictationOnText: null as null | ((segment: string) => void),
}));

vi.mock("@tanstack/react-query", () => ({ useQuery: () => ({ data: null }) }));
vi.mock("@/hooks/useTenantContext", () => ({ useTenantContext: () => ({ activeTenantId: chatHarness.tenantId, activeTenant: chatHarness.tenantId ? { account_number: "42" } : null }) }));
vi.mock("@/hooks/useScopedUserId", () => ({ useScopedUserId: () => "owner-1" }));
vi.mock("@/lib/playbook", () => ({ usePlaybook: () => ({ persona: { name: "PAIGE" } }) }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock("@/components/voice/DictationMicButton", () => ({
  DictationMicButton: ({ onText }: { onText: (segment: string) => void }) => {
    chatHarness.dictationOnText = onText;
    return <button type="button" aria-label="Hold to dictate" onClick={() => onText("microphone words")}>Mock hold to dictate</button>;
  },
}));
vi.mock("@/hooks/useChatDocumentUpload", () => ({
  useChatDocumentUpload: () => ({
    attachedDoc: null, isDragOver: false, fileInputRef: { current: null }, acceptString: ".pdf",
    handleFileSelect: vi.fn(), handleDragOver: vi.fn(), handleDragLeave: vi.fn(), handleDrop: vi.fn(),
    removeAttachment: vi.fn(), openFilePicker: vi.fn(), setAttachedDoc: vi.fn(),
  }),
}));
vi.mock("./data/useSoloKnowledge", () => ({
  useSoloKnowledge: () => ({ loading: false, error: null, empty: true, docs: [], refresh: vi.fn() }),
}));
vi.mock("./data/useSoloSkills", () => ({
  useSoloSkills: () => ({ loading: false, error: null, empty: true, skills: [], refresh: vi.fn() }),
}));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { auth: { getSession: vi.fn(async () => ({ data: { session: { access_token: "test" } } })) } } }));
// The composer permission chip mounts useSoloToolGovernance; this workspace test isn't exercising the
// governance seam, so stub it to a benign resting state rather than driving the real RPCs (the chip's
// own behavior is covered in PaigeComposerAutonomyChip.test.tsx).
vi.mock("@/solo/data/useSoloToolGovernance", () => ({
  useSoloToolGovernance: () => ({
    loading: false, configured: false, error: null, domains: [], byTool: {},
    ceilingLimiting: false, ceilingUnconfirmed: false, canWrite: false, authorityUnconfirmed: false,
    setDomainMode: vi.fn(async () => ({ ok: true })), setToolMode: vi.fn(async () => ({ ok: true })), refresh: vi.fn(),
  }),
}));
vi.mock("@/hooks/usePaigeThreads", () => ({
  usePaigeThreads: () => ({
    threads: [
      { id: "thread-a", title: "Account plan", last_message_at: null, message_count: 1, is_archived: false, updated_at: null },
      { id: "thread-b", title: "Failed load", last_message_at: null, message_count: 1, is_archived: false, updated_at: null },
      { id: "thread-c", title: "Superseding load", last_message_at: null, message_count: 1, is_archived: false, updated_at: null },
    ],
    isLoading: false, isFetched: true, loadTurns: chatHarness.loadTurns,
    ensureThread: chatHarness.ensureThread, onTurnPersisted: vi.fn(), renameThread: vi.fn(), archiveThread: vi.fn(), deleteThread: vi.fn(),
  }),
}));
vi.mock("@/components/dashboard/paige/ThreadRail", () => ({
  ThreadRail: ({ activeThreadId, onSelect }: { activeThreadId: string | null; onSelect: (id: string) => void }) => (
    <aside><output data-active-thread>{activeThreadId}</output><button type="button" onClick={() => onSelect("thread-b")}>Open failed thread</button><button type="button" onClick={() => onSelect("thread-c")}>Open superseding thread</button></aside>
  ),
}));

const source = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const RouteProbe = () => {
  const location = useLocation();
  return <output data-route>{location.pathname}</output>;
};

describe("Solo PAIGE workspace contract", () => {
  it("ships the approved taxonomy without a second Memory or Code workspace", () => {
    const workspace = source("src/solo/SoloPaigeWorkspace.tsx");
    expect(workspace).toContain('label: "Chat"');
    expect(workspace).toContain('label: "Knowledge"');
    expect(workspace).toContain('label: "Helpers"');
    expect(workspace).toContain('label: "Capabilities"');
    expect(workspace).not.toMatch(/label:\s*["']Memory["']/);
    expect(workspace).not.toMatch(/label:\s*["']Code|Sandbox["']/);
    expect(workspace).toContain('useSubtabRoute("solo", "paige", "chat")');
  });

  it("deep-links and switches the canonical Solo PAIGE subtabs", async () => {
    chatHarness.loadTurns.mockResolvedValue([]);
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    await act(async () => {
      root.render(
        <MemoryRouter initialEntries={["/solo/42/paige/knowledge"]}>
          <Routes>
            <Route path="/solo/:account/*" element={<><SoloPaigeWorkspace full /><RouteProbe /></>} />
          </Routes>
        </MemoryRouter>,
      );
      await Promise.resolve();
    });
    expect(host.querySelector('[role="tab"][aria-selected="true"]')?.textContent).toContain("Knowledge");
    await act(async () => {
      Array.from(host.querySelectorAll<HTMLButtonElement>('[role="tab"]')).find((button) => button.textContent?.includes("Helpers"))?.click();
      await Promise.resolve();
    });
    expect(host.querySelector("[data-route]")?.textContent).toBe("/solo/42/paige/helpers");
    await act(async () => root.unmount());
    host.remove();
  });

  it("keeps secondary tabs docked over product context and canonicalizes stale full routes", async () => {
    chatHarness.loadTurns.mockResolvedValue([]);
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    await act(async () => {
      root.render(
        <MemoryRouter initialEntries={["/solo/42/calendar"]}>
          <Routes>
            <Route path="/solo/:account/*" element={<><SoloPaigeWorkspace full={false} /><RouteProbe /></>} />
          </Routes>
        </MemoryRouter>,
      );
      await Promise.resolve();
    });
    await act(async () => {
      Array.from(host.querySelectorAll<HTMLButtonElement>('[role="tab"]')).find((button) => button.textContent?.includes("Knowledge"))?.click();
      await Promise.resolve();
    });
    expect(host.querySelector('[role="tab"][aria-selected="true"]')?.textContent).toContain("Knowledge");
    expect(host.querySelector("[data-route]")?.textContent).toBe("/solo/42/calendar");
    await act(async () => root.unmount());

    const staleRoot = createRoot(host);
    await act(async () => {
      staleRoot.render(
        <MemoryRouter initialEntries={["/solo/42/paige/skills"]}>
          <Routes>
            <Route path="/solo/:account/*" element={<><SoloPaigeWorkspace full /><RouteProbe /></>} />
          </Routes>
        </MemoryRouter>,
      );
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(host.querySelector("[data-route]")?.textContent).toBe("/solo/42/paige/chat");
    await act(async () => staleRoot.unmount());
    host.remove();
  });

  it("keeps named leadership contextual and disputed assignments out of the Helpers view", () => {
    const workspace = source("src/solo/SoloPaigeWorkspace.tsx");
    expect(workspace).toContain("Current delegations");
    expect(workspace).toContain("Ephemeral helper");
    expect(workspace).toContain("Department specialist");
    expect(workspace).toContain("Durable named leadership");
    expect(workspace).not.toMatch(/ZION|OATHEN|MASON|KAVYN|MIRAEL|VAYRON|METHRA/);
    expect(workspace).not.toContain("Sub-Agent Console");
    expect(workspace).not.toContain("Forge sub-agent");
    expect(workspace).not.toContain("useSoloSubagents");
  });

  it("links to the canonical governed Mind while keeping authority local to the action", () => {
    const workspace = source("src/solo/SoloPaigeWorkspace.tsx");
    expect(workspace).toContain("Mind is available");
    expect(workspace).toContain("/command-center/mind");
    expect(workspace).toContain("does not invent relationships or unavailable history");
    expect(source("src/components/tenant-shell/TenantCommandCenterShell.tsx")).toContain("Ask first");
    expect(workspace).not.toMatch(/conversationHeader=\{[^\n]*Ask first/);
  });

  it("opens Mind from the existing PAIGE knowledge surface only after account resolution", async () => {
    chatHarness.tenantId = "account-a";
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    await act(async () => root.render(
      <MemoryRouter initialEntries={["/solo/42/paige/knowledge"]}>
        <Routes><Route path="/solo/:account/*" element={<><SoloPaigeWorkspace full /><RouteProbe /></>} /></Routes>
      </MemoryRouter>,
    ));
    const open = Array.from(host.querySelectorAll<HTMLButtonElement>("button")).find((item) => item.textContent?.includes("Open in Mind"))!;
    expect(open.disabled).toBe(false);
    await act(async () => open.click());
    expect(host.querySelector("[data-route]")?.textContent).toBe("/solo/42/command-center/mind");
    await act(async () => root.unmount());
    host.remove();
  });

  it("keeps the shared async safety additive and Solo-only", () => {
    const chat = source("src/components/dashboard/PaigeAIChat.tsx");
    const composerScope = source("src/lib/paigeComposerScopeState.ts");
    const shell = source("src/components/tenant-shell/TenantCommandCenterShell.tsx");
    const operator = source("src/components/paige/PaigePlatformDesk.tsx");
    const sharedWorkspace = source("src/components/paige/PaigeWorkspace.tsx");
    expect(chat).toContain("soloTenantSafety?: boolean");
    expect(chat).toContain("createComposerRequestFence()");
    expect(composerScope).toContain("new AbortController()");
    expect(chat).toContain("signal: requestTicket.signal");
    expect(chat).toContain("Cancel PAIGE response");
    expect(shell).not.toContain("soloTenantSafety");
    expect(operator).not.toContain("soloTenantSafety");
    expect(sharedWorkspace).not.toContain("soloTenantSafety");
    expect(chat).not.toContain("soloTenantSafety ? null : (");
    expect(chat).toContain("<DictationMicButton");
    expect(chat).toContain("showStatus={soloTenantSafety}");
    expect(chat).toContain('aria-label="Clear unsent message"');
    expect(chat).toContain("setAttachedDoc(null)");
    expect(chat).toContain("A delayed provider final can never become the next draft");
  });

  it("aborts and rejects every stale request generation", () => {
    const fence = createComposerRequestFence();
    const scopeA = { tenantId: "account-a", userId: "user-a", focusedClientId: "none", focusedBusinessMissionId: "none", conversationId: "thread-a" };
    const scopeB = { tenantId: "account-b", userId: "user-a", focusedClientId: "none", focusedBusinessMissionId: "none", conversationId: "thread-b" };
    const accountA = fence.begin(scopeA, "account-a");
    expect(fence.isCurrent(accountA, scopeA, "account-a")).toBe(true);

    fence.invalidate();
    expect(accountA.signal.aborted).toBe(true);
    expect(fence.isCurrent(accountA, scopeA, "account-a")).toBe(false);

    const accountB = fence.begin(scopeB, "account-b");
    expect(fence.isCurrent(accountA, scopeB, "account-b")).toBe(false);
    expect(fence.isCurrent(accountB, scopeB, "account-b")).toBe(true);
  });

  it("cannot commit delayed account-A or history work after account B is accepted", async () => {
    const fence = createComposerRequestFence();
    const committed: string[] = [];
    const scopeA = { tenantId: "account-a", userId: "user-a", focusedClientId: "none", focusedBusinessMissionId: "none", conversationId: "thread-a" };
    const scopeB = { tenantId: "account-b", userId: "user-a", focusedClientId: "none", focusedBusinessMissionId: "none", conversationId: "thread-b" };
    const accountA = fence.begin(scopeA, "account-a");
    let releaseAccountA!: () => void;
    const delayedAccountA = new Promise<void>((resolve) => { releaseAccountA = resolve; }).then(() => {
      if (fence.isCurrent(accountA, scopeB, "account-b")) committed.push("account-a transcript or history");
    });

    fence.invalidate();
    const accountB = fence.begin(scopeB, "account-b");
    releaseAccountA();
    await delayedAccountA;
    if (fence.isCurrent(accountB, scopeB, "account-b")) committed.push("account-b accepted");

    expect(committed).toEqual(["account-b accepted"]);
  });

  it("cannot let a superseded request timeout invalidate the accepted request", () => {
    vi.useFakeTimers();
    const fence = createComposerRequestFence();
    const scopeA = { tenantId: "account-a", userId: "user-a", focusedClientId: "none", focusedBusinessMissionId: "none", conversationId: "thread-a" };
    const scopeB = { tenantId: "account-b", userId: "user-a", focusedClientId: "none", focusedBusinessMissionId: "none", conversationId: "thread-b" };
    const accountA = fence.begin(scopeA, "account-a");
    window.setTimeout(() => {
      if (!fence.isCurrent(accountA, scopeB, "account-b")) return;
      fence.invalidate();
    }, 45_000);
    const accountB = fence.begin(scopeB, "account-b");
    vi.advanceTimersByTime(45_000);
    expect(fence.isCurrent(accountB, scopeB, "account-b")).toBe(true);
    vi.useRealTimers();
    expect(source("src/components/dashboard/PaigeAIChat.tsx")).toMatch(/setTimeout\(\(\) => \{\s*if \(!ticketAccepted\(requestTicket\)\) return;/);
  });

  it("behaviorally restores the prior thread when the next transcript cannot hydrate", async () => {
    chatHarness.tenantId = "account-a";
    chatHarness.loadTurns.mockImplementation(async (id: string) => {
      if (id === "thread-b") throw new Error("history unavailable");
      return [{ id: "turn-a", role: "user", content: "Account A context", bundle_ref: null, surfaces_used: null, seq: 1, created_at: null }];
    });
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    await act(async () => {
      root.render(<PaigeAIChat hideHeader fill enableHistory soloTenantSafety />);
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(host.querySelector("[data-active-thread]")?.textContent).toBe("thread-a");
    await act(async () => {
      host.querySelector<HTMLButtonElement>("button")?.click();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(host.querySelector("[data-active-thread]")?.textContent).toBe("thread-a");
    expect(host.textContent).toContain("Account A context");
    await act(async () => root.unmount());
    host.remove();
  });

  it("behaviorally restores the displayed transcript owner after overlapping selections", async () => {
    chatHarness.tenantId = "account-a";
    let releaseThreadB!: (turns: unknown[]) => void;
    const pendingThreadB = new Promise<unknown[]>((resolve) => { releaseThreadB = resolve; });
    chatHarness.loadTurns.mockImplementation(async (id: string) => {
      if (id === "thread-b") return pendingThreadB;
      if (id === "thread-c") throw new Error("superseding history unavailable");
      return [{ id: "turn-a", role: "user", content: "Displayed A context", bundle_ref: null, surfaces_used: null, seq: 1, created_at: null }];
    });
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    await act(async () => {
      root.render(<PaigeAIChat hideHeader fill enableHistory soloTenantSafety />);
      await Promise.resolve();
      await Promise.resolve();
    });
    const buttons = Array.from(host.querySelectorAll<HTMLButtonElement>("aside button"));
    await act(async () => { buttons.find((button) => button.textContent === "Open failed thread")?.click(); await Promise.resolve(); });
    expect(host.querySelector("[data-active-thread]")?.textContent).toBe("thread-b");
    await act(async () => { buttons.find((button) => button.textContent === "Open superseding thread")?.click(); await Promise.resolve(); await Promise.resolve(); });
    expect(host.querySelector("[data-active-thread]")?.textContent).toBe("thread-a");
    expect(host.textContent).toContain("Displayed A context");
    await act(async () => { releaseThreadB([]); await Promise.resolve(); });
    expect(host.querySelector("[data-active-thread]")?.textContent).toBe("thread-a");
    await act(async () => root.unmount());
    host.remove();
  });

  it("clears account-authored UI before the next account hydrates", () => {
    const chat = source("src/components/dashboard/PaigeAIChat.tsx");
    const app = source("src/solo/SoloApp.tsx");
    // The shared scope handle, not a parallel epoch-only dimension, carries tenant, effective user,
    // focused client and focused mission. A focus switch therefore changes drafts and delivery
    // acceptance together. The ordering remains accept, abort, then clear.
    expect(chat).toMatch(/createComposerScopeIdentity\(\{[\s\S]*tenantId: platform \? "platform" : activeTenantId,[\s\S]*userId: scopedUserId,[\s\S]*focusedClientId: clientId,[\s\S]*focusedBusinessMissionId: businessMissionId,/);
    expect(chat).toContain("const scopeEpoch = draftIdentity ? composerScopeIdentityKey(draftIdentity) : \"identity-unresolved\"");
    expect(chat).toContain("? composerDraftKey(requestScopeHandle)");
    // Bounded so it cannot reach the LATER abort calls (startNewChat, unmount). The
    // unbounded `[\s\S]*` version could not fail: inverting the accept/abort order left the
    // whole 507-test suite green.
    expect(chat).toMatch(/acceptedEpochRef\.current = scopeEpoch;(?:[^\n]*\n){0,10}\s*abortActiveRequest\(\);/);
    expect(chat).toMatch(/const abortActiveRequest = useCallback\(\(\) => \{(?:[^\n]*\n){0,3}\s*if \(requestFenceRef\.current\.invalidate\(\)\) setIsLoading\(false\);/);
    // §13 — THIS ASSERTION HAD GONE VACUOUS. The reset now seeds `scopeNotice ?? openingGreeting`,
    // so the old literal no longer matched the reset at all — it was satisfied by the unrelated
    // `startNewChat` and controlled-sync sites, and deleting the reset's `setMessages` entirely
    // left this suite 23/23 green. Caught by an independent reviewer's mutation, not by reading.
    expect(chat).toContain("setMessages([mkMsg({ role: \"assistant\", content: scopeNotice ?? openingGreeting })])");
    expect(chat).toContain('setInput("")');
    expect(chat).toContain("setAttachedDoc(null)");
    expect(chat).toContain("setIsLoading(false)");
    // #765 — this became CONDITIONAL, and the condition is the point. Re-arming the resume
    // unconditionally let the auto-resume overwrite a refusal notice THIS SAME reset had just
    // adopted two lines above, on any account holding at least one saved thread — which is every
    // real account, and which is why `pendingScopeNoticeRef` was inert in production.
    // An ACCOUNT switch still re-arms exactly as before: a notice is adopted only when
    // `parked.epoch === leavingEpoch`, and a refusal parks under a CLIENT epoch, so an account
    // transition never carries one and `scopeNotice` is null. The behaviour this line was written
    // to pin is unchanged; only the refusal path is now protected.
    expect(chat).toContain("let nextConversation = initialComposerConversation(enableHistory, newConversationId)");
    expect(chat).toContain('type: "history-confirmed-empty"');
    expect(chat).toContain("conversationStateRef.current = nextConversation");
    expect(chat).toContain("setConversationState(nextConversation)");
    expect(chat).toContain("retryTurnRef.current = null");
    expect(app).toMatch(/paigeTabEpochRef\.current=activeTenantId;setPaigeDockedTab\('chat'\)/);
  });

  it("uses the authenticated active tenant only as an invalidation epoch", () => {
    const workspace = source("src/solo/SoloPaigeWorkspace.tsx");
    const app = source("src/solo/SoloApp.tsx");
    expect(workspace).toContain("activeTenantId");
    expect(workspace).toContain("soloTenantSafety");
    expect(app).toContain("activeTenantId");
    expect(app).toContain("accountEpochKey");
    expect(app).toContain("activeTenantId??'resolving'");
    expect(app).not.toMatch(/accountEpochKey=.*urlAccount/);
    expect(app).toContain("soloPaigeWorkspace={<SoloPaigeWorkspace key={accountEpochKey}");
  });

  it("blocks sends during account resolution and thread hydration and guards history failures", () => {
    const chat = source("src/components/dashboard/PaigeAIChat.tsx");
    const scopeState = source("src/lib/paigeComposerScopeState.ts");
    expect(chat).toContain("soloTenantSafety && !activeTenantId");
    expect(chat).toContain('applyConversationEvent({ type: "thread-requested", id, intent })');
    expect(chat).toContain("const composerScope = resolveComposerScopeState({");
    expect(chat).toContain("if (!ticketAccepted(requestTicket)) return;");
    expect(chat).toContain("composerBlocked");
    expect(scopeState).toContain("Resolving the conversation before you can write to PAIGE.");
    expect(chat).toContain("previousTranscriptThreadId");
    expect(chat).toMatch(/hydratedFromRef\.current = id;[\s\S]*setConnectionIssue\(null\);[\s\S]*retryTurnRef\.current = null;/);
  });

  it("keeps structured action frames while filtering private thought steps for Solo", () => {
    const chat = source("src/components/dashboard/PaigeAIChat.tsx");
    expect(chat).toContain('steps.filter((step) => step.kind !== "thought")');
    expect(chat).toContain("approval_queued");
    expect(chat).toContain("paige_confirm");
    expect(chat).toContain("paige_artifact");
    expect(source("src/solo/SoloPaigeWorkspace.tsx")).not.toContain("hideReasoningStrip");
  });

  it("includes searchable conversation history and honest recoverable connection states", () => {
    const workspace = source("src/solo/SoloPaigeWorkspace.tsx");
    const chat = source("src/components/dashboard/PaigeAIChat.tsx");
    expect(workspace).toContain("Search conversations");
    expect(workspace).toContain("renderRail");
    expect(chat).toContain('navigator.onLine === false');
    expect(chat).toContain('setConnectionIssue("timeout")');
    // C3a (declared change): the jargon cancel notice is replaced by the Stop footer on the answer.
    // Its truth is kept — Stop does not confirm that started work was cancelled on the server.
    expect(chat).toContain('settleLiveTurn("cancelled", undefined, { stopFocus: !opts?.fromVoice });');
    // Stop ends the read, not the work: the footer claims nothing about what was saved or cancelled.
    const view = source("src/lib/paige-stream/turn-view.ts");
    expect(view).toContain("Stopped showing this answer. ${name} may still finish work that had already started.");
    expect(view).not.toContain("Anything already finished is saved");
    expect(chat).not.toContain("server-side work cancellation is not confirmed");
  });

  it("appends dictation to unsent text without sending and clears it locally with focus restored", async () => {
    chatHarness.tenantId = "account-a";
    chatHarness.loadTurns.mockResolvedValue([]);
    chatHarness.ensureThread.mockClear();
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    await act(async () => {
      root.render(<PaigeAIChat hideHeader fill enableHistory soloTenantSafety />);
      await Promise.resolve();
      await Promise.resolve();
    });
    const composer = host.querySelector<HTMLTextAreaElement>('textarea[placeholder="Talk while she works…"]')!;
    const valueSetter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!;
    await act(async () => {
      valueSetter.call(composer, "Existing unsent text");
      composer.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      Array.from(host.querySelectorAll<HTMLButtonElement>("button")).find((button) => button.textContent === "Mock hold to dictate")?.click();
    });
    expect(composer.value).toBe("Existing unsent text microphone words");
    expect(chatHarness.ensureThread).not.toHaveBeenCalled();
    const releasedRecordingCallback = chatHarness.dictationOnText;

    await act(async () => {
      host.querySelector<HTMLButtonElement>('button[aria-label="Clear unsent message"]')?.click();
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    });
    expect(composer.value).toBe("");
    expect(document.activeElement).toBe(composer);
    await act(async () => releasedRecordingCallback?.("late words"));
    expect(composer.value).toBe("");
    expect(chatHarness.ensureThread).not.toHaveBeenCalled();
    await act(async () => root.unmount());
    host.remove();
  });

  it("gives Solo an open three-level composer without changing the shared default", async () => {
    chatHarness.tenantId = "account-a";
    chatHarness.loadTurns.mockResolvedValue([]);
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    await act(async () => {
      root.render(<PaigeAIChat hideHeader fill enableHistory soloTenantSafety />);
      await Promise.resolve();
      await Promise.resolve();
    });

    const composer = host.querySelector<HTMLElement>('[data-solo-composer="true"]')!;
    const inputArea = composer.querySelector<HTMLElement>("[data-solo-composer-input]")!;
    const guidance = composer.querySelector<HTMLElement>("[data-solo-composer-guidance]")!;
    const actions = composer.querySelector<HTMLElement>("[data-solo-composer-actions]")!;
    const textarea = inputArea.querySelector<HTMLTextAreaElement>("textarea")!;

    expect(textarea.placeholder).toBe("Talk while she works…");
    // §70/§13 — THIS PINNED A CLAIM WITH NOTHING BEHIND IT. The three sigils it named all did
    // nothing in Solo: no chips are passed, so the slash menu can never open, and there is no
    // at-sign or hash handling in the chat at all. The ROW stays, because the three-level composer
    // is CD's layout and deleting a level would be restyling their surface (§00); the TEXT goes,
    // because an honest absence is what CC owes a value with no capability behind it. What belongs
    // here is CD's to decide and is filed as owed.
    expect(guidance.textContent).toBe("");
    expect(guidance.querySelector("button, a")).toBeNull();
    expect(guidance.querySelector("button, a")).toBeNull();
    expect(composer.children[0]).toBe(inputArea);
    expect(composer.children[1]).toBe(guidance);
    expect(composer.children[2]).toBe(actions);
    expect(actions.contains(textarea)).toBe(false);
    const mic = actions.querySelector<HTMLButtonElement>('[aria-label="Hold to dictate"]')!;
    const attach = actions.querySelector<HTMLButtonElement>('[aria-label="Attach a document"]')!;
    const send = actions.querySelector<HTMLButtonElement>('[aria-label="Send message"]')!;
    const actionButtons = Array.from(actions.querySelectorAll("button"));
    expect(actionButtons.indexOf(mic)).toBeLessThan(actionButtons.indexOf(attach));
    expect(actionButtons.at(-1)).toBe(send);

    await act(async () => root.unmount());
    host.remove();

    const sharedHost = document.createElement("div");
    document.body.appendChild(sharedHost);
    const sharedRoot = createRoot(sharedHost);
    await act(async () => {
      sharedRoot.render(<PaigeAIChat hideHeader fill />);
      await Promise.resolve();
    });
    expect(sharedHost.querySelector('[data-solo-composer="true"]')).toBeNull();
    expect(sharedHost.querySelector<HTMLTextAreaElement>("textarea")?.placeholder).toBe("Message PAIGE — type / for commands");
    await act(async () => sharedRoot.unmount());
    sharedHost.remove();
  });

  it("lets a Solo reader jump the existing transcript scroll owner to the latest message", async () => {
    chatHarness.tenantId = "account-a";
    chatHarness.loadTurns.mockResolvedValue([]);
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    await act(async () => {
      root.render(<PaigeAIChat hideHeader fill enableHistory soloTenantSafety />);
      await Promise.resolve();
      await Promise.resolve();
    });

    const transcript = host.querySelector<HTMLDivElement>('[data-paige-transcript-scroll="true"]')!;
    Object.defineProperties(transcript, {
      clientHeight: { configurable: true, value: 300 },
      scrollHeight: { configurable: true, value: 1_200 },
    });
    visibleTranscriptGeometry(transcript);
    transcript.dispatchEvent(new WheelEvent("wheel"));
    transcript.scrollTop = 240;
    await act(async () => transcript.dispatchEvent(new Event("scroll", { bubbles: true })));

    const jump = host.querySelector<HTMLButtonElement>('button[aria-label="Jump to latest message"]')!;
    expect(jump).toBeTruthy();
    expect(jump.getAttribute("aria-controls")).toBe("solo-paige-transcript");

    const scrollTo = vi.fn(({ top }: ScrollToOptions) => { transcript.scrollTop = Math.min(Number(top), transcript.scrollHeight - transcript.clientHeight); });
    Object.defineProperty(transcript, "scrollTo", { configurable: true, value: scrollTo });
    await act(async () => {
      jump.click();
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    });

    expect(scrollTo).toHaveBeenCalledWith({ top: 1_200, behavior: "smooth" });
    expect(document.activeElement).toBe(host.querySelector('textarea[placeholder="Talk while she works…"]'));
    expect(host.querySelector('button[aria-label="Jump to latest message"]')).toBeNull();

    const originalMatchMedia = window.matchMedia;
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: vi.fn(() => ({ matches: true })),
    });
    transcript.dispatchEvent(new WheelEvent("wheel"));
    transcript.scrollTop = 120;
    await act(async () => transcript.dispatchEvent(new Event("scroll", { bubbles: true })));
    scrollTo.mockClear();
    await act(async () => host.querySelector<HTMLButtonElement>('button[aria-label="Jump to latest message"]')?.click());
    expect(scrollTo).toHaveBeenCalledWith({ top: 1_200, behavior: "auto" });
    Object.defineProperty(window, "matchMedia", { configurable: true, value: originalMatchMedia });
    await act(async () => root.unmount());
    host.remove();
  });

  it("does not steal an older reading position when new streaming content arrives", async () => {
    chatHarness.tenantId = "account-a";
    chatHarness.loadTurns.mockResolvedValue([]);
    chatHarness.ensureThread.mockResolvedValue("thread-new");
    let streamController!: ReadableStreamDefaultController<Uint8Array>;
    const stream = new ReadableStream<Uint8Array>({ start: (controller) => { streamController = controller; } });
    vi.stubGlobal("fetch", vi.fn(async () => new Response(stream, { status: 200 })));
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    await act(async () => {
      root.render(<PaigeAIChat hideHeader fill enableHistory soloTenantSafety />);
      await Promise.resolve();
      await Promise.resolve();
    });

    const transcript = host.querySelector<HTMLDivElement>('[data-paige-transcript-scroll="true"]')!;
    Object.defineProperties(transcript, {
      clientHeight: { configurable: true, value: 300 },
      scrollHeight: { configurable: true, value: 1_200 },
    });
    visibleTranscriptGeometry(transcript);
    transcript.dispatchEvent(new WheelEvent("wheel"));
    transcript.scrollTop = 180;
    await act(async () => transcript.dispatchEvent(new Event("scroll", { bubbles: true })));
    const composer = host.querySelector<HTMLTextAreaElement>('textarea[placeholder="Talk while she works…"]')!;
    const valueSetter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!;
    await act(async () => {
      valueSetter.call(composer, "Local streaming test");
      composer.dispatchEvent(new Event("input", { bubbles: true }));
      await Promise.resolve();
    });
    await act(async () => {
      host.querySelector<HTMLButtonElement>('button[aria-label="Send message"]')?.click();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(transcript.scrollTop).toBe(180);

    const encoder = new TextEncoder();
    await act(async () => {
      streamController.enqueue(encoder.encode('data: {"choices":[{"delta":{"content":"New streamed content"}}]}\n'));
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(transcript.scrollTop).toBe(180);
    const jump = host.querySelector<HTMLButtonElement>('button[aria-label="Jump to latest message"]')!;
    expect(jump).toBeTruthy();
    expect(jump.title).toBe("Newer PAIGE content is available");
    expect(host.textContent).toContain("Newer PAIGE content is available.");

    await act(async () => {
      streamController.enqueue(encoder.encode("data: [DONE]\n"));
      streamController.close();
      await Promise.resolve();
      await Promise.resolve();
    });
    await act(async () => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
  });

  it("rejects a late dictation result after the authenticated account epoch changes", async () => {
    chatHarness.tenantId = "account-a";
    chatHarness.loadTurns.mockResolvedValue([]);
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    await act(async () => {
      root.render(<PaigeAIChat hideHeader fill enableHistory soloTenantSafety />);
      await Promise.resolve();
      await Promise.resolve();
    });
    const accountACallback = chatHarness.dictationOnText!;
    const accountATranscript = host.querySelector<HTMLDivElement>('[data-paige-transcript-scroll="true"]')!;
    Object.defineProperties(accountATranscript, {
      clientHeight: { configurable: true, value: 300 },
      scrollHeight: { configurable: true, value: 1_200 },
    });
    visibleTranscriptGeometry(accountATranscript);
    accountATranscript.dispatchEvent(new WheelEvent("wheel"));
    accountATranscript.scrollTop = 120;
    await act(async () => accountATranscript.dispatchEvent(new Event("scroll", { bubbles: true })));
    expect(host.querySelector('button[aria-label="Jump to latest message"]')).toBeTruthy();
    chatHarness.tenantId = "account-b";
    await act(async () => {
      root.render(<PaigeAIChat hideHeader fill enableHistory soloTenantSafety />);
      await Promise.resolve();
      await Promise.resolve();
    });
    await act(async () => accountACallback("stale account A speech"));
    const composer = host.querySelector<HTMLTextAreaElement>('textarea[placeholder="Talk while she works…"]')!;
    expect(composer.value).toBe("");
    expect(host.textContent).not.toContain("stale account A speech");
    expect(host.querySelector('button[aria-label="Jump to latest message"]')).toBeNull();
    await act(async () => root.unmount());
    host.remove();
  });

  it("preserves the approved prototype lineage in implementation source", () => {
    const workspace = source("src/solo/SoloPaigeWorkspace.tsx");
    expect(workspace).toContain("51D7A6F680DB83AEF6BFE1147E9FC1651E39206EFAED17963F2FC16EC294F117");
  });
});
