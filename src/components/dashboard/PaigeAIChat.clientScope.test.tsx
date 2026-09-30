/**
 * S2 — a client switch ends the conversation, the way an account switch already does.
 *
 * THE DEFECT THESE PIN. `PaigeAIChat` re-POSTs its whole local `messages` array on every turn
 * (see the `messages` payload in `handleSend`). The account-change effect clears that array, so an
 * account switch cannot carry the previous workspace's content forward. There was no equivalent
 * for `clientId`: focusing a different client — or clearing focus entirely — left client A's
 * answers in the transcript, and the next turn shipped them to the model under client B's scope.
 * The backend's client-scope guard authorizes the NAMED client; it cannot know that the prose
 * already in the array is about someone else.
 *
 * Written before the fix and confirmed red: without a scope-keyed reset, assertion 1 finds
 * "Client A private answer" still on screen after the switch.
 */
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { PaigeAIChat } from "@/components/dashboard/PaigeAIChat";

const harness = vi.hoisted(() => ({
  tenantId: "account-a" as string | null,
  // An account's SAVED conversations. Defaulted empty so every pre-existing test in this
  // file behaves exactly as before — and note that this default is precisely why #765 hid:
  // with no saved thread there is nothing to auto-resume, so the defect cannot fire.
  threads: [] as Array<{ id: string; title: string; updated_at: string }>,
  loadTurns: vi.fn(async (_id: string): Promise<Array<{
    role: string;
    content: string;
    id?: string;
    created_at?: string;
    bundle_ref?: Record<string, unknown>;
  }>> => []),
  liveCard: null as null | { id: string; title: string },
  liveFingerprints: [] as string[],
}));

vi.mock("@tanstack/react-query", () => ({ useQuery: () => ({ data: null }) }));
vi.mock("@/hooks/useTenantContext", () => ({
  useTenantContext: () => ({ activeTenantId: harness.tenantId, activeTenant: { account_number: "42" } }),
}));
vi.mock("@/hooks/useScopedUserId", () => ({ useScopedUserId: () => "owner-1" }));
vi.mock("@/lib/playbook", () => ({ usePlaybook: () => ({ persona: { name: "PAIGE" } }) }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock("@/components/voice/DictationMicButton", () => ({ DictationMicButton: () => <button type="button">mic</button> }));
vi.mock("@/hooks/useChatDocumentUpload", () => ({
  useChatDocumentUpload: () => ({
    attachedDoc: null, isDragOver: false, fileInputRef: { current: null }, acceptString: ".pdf",
    handleFileSelect: vi.fn(), handleDragOver: vi.fn(), handleDragLeave: vi.fn(), handleDrop: vi.fn(),
    removeAttachment: vi.fn(), openFilePicker: vi.fn(), setAttachedDoc: vi.fn(),
  }),
}));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { auth: { getSession: vi.fn(async () => ({ data: { session: { access_token: "test" } } })) } },
}));
vi.mock("@/hooks/usePaigeThreads", () => ({
  usePaigeThreads: () => ({
    threads: harness.threads, isLoading: false, isFetched: true,
    loadTurns: harness.loadTurns, ensureThread: vi.fn(async () => "thread-a"),
    onTurnPersisted: vi.fn(), renameThread: vi.fn(), archiveThread: vi.fn(), deleteThread: vi.fn(),
  }),
}));
vi.mock("@/components/paige/live/PaigeLiveConversation", () => ({
  PaigeLiveConversation: (props: { activeCard: null | { id: string; title: string }; confirmationFingerprints: string[] }) => {
    harness.liveCard = props.activeCard;
    harness.liveFingerprints = props.confirmationFingerprints;
    return <button type="button">Talk live with Paige</button>;
  },
}));
vi.mock("@/components/paige/chat/PaigeArtifactCard", () => ({
  PaigeArtifactCard: ({ artifact, tenantId }: { artifact: { id: string; title: string }; tenantId: string }) => (
    <div data-testid={`artifact-${artifact.id}`}>{tenantId}:{artifact.title}</div>
  ),
}));

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

/**
 * An SSE body delivered CHUNK BY CHUNK, with an optional gate before a chosen chunk.
 *
 * §13 — the first version of this file delivered the whole body in one read, which is why every
 * test in it passed while the surface was still broken. A single chunk means the stream is over
 * before a switch can land, so it can only ever exercise the between-turns case. The defect an
 * independent reviewer found lives entirely in the MID-STREAM case: the reset clears the
 * transcript, and the next chunk's `setMessages([...newMessages, …])` — closed over the array
 * captured before the switch — puts the previous client's content straight back.
 */
const sseResponse = (frames: string[], opts: { gateBefore?: number; gate?: Promise<void> } = {}) => ({
  ok: true,
  status: 200,
  body: {
    getReader() {
      let i = 0;
      return {
        async read() {
          if (i >= frames.length) return { done: true, value: undefined };
          if (opts.gate && i === opts.gateBefore) await opts.gate;
          const value = new TextEncoder().encode(frames[i]);
          i += 1;
          return { done: false, value };
        },
        releaseLock() {},
      };
    },
  },
});

/**
 * MOUNTED THE WAY THE CLIENT-FOCUSING SURFACE ACTUALLY MOUNTS — `hideHeader fill enableHistory`,
 * and NO `soloTenantSafety`.
 *
 * CORRECTED (#765): this rationale used to read "Solo passes no `clientId`". That stopped being
 * true when Solo gained the Pipeline client-scope seam — `SoloPaigeWorkspace.tsx:335-343` now
 * passes `soloTenantSafety`, `clientId` AND `onFocusRelease` together. So BOTH client-focusing
 * surfaces matter, and `selectThread` takes materially different branches under that flag. The
 * default mount here stays flag-free (that is `PaigeWorkspace`); the Solo configuration is pinned
 * explicitly in the #765 block below rather than left to inference.
 */
const mount = async (props: Record<string, unknown>) => {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => {
    root.render(<PaigeAIChat hideHeader fill enableHistory {...props} />);
    await Promise.resolve();
  });
  return { host, root };
};

describe("PAIGE chat — a client switch ends the conversation", () => {
  it("clears the prior context card and never binds a mismatched action confirmation", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => sseResponse([
      `data: ${JSON.stringify({ paige_confirm: { tool: "move_deal", summary: "Move Deal A", fingerprint: "canonical-fingerprint" } })}\n\n`,
      `data: ${JSON.stringify({ paige_live_card: { id: "stale-action", kind: "governed-action", title: "Move Deal B", source: { availability: "LIVE" }, action: { toolName: "move_deal", authorityStatus: "confirmation-required", confirmationFingerprints: ["different-fingerprint"] } } })}\n\n`,
      "data: [DONE]\n\n",
    ])));
    const { host, root } = await mount({ soloTenantSafety: true, clientId: "client-a" });
    const textarea = host.querySelector("textarea")!;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value")!.set!;
      setter.call(textarea, "move this deal");
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const send = Array.from(host.querySelectorAll<HTMLButtonElement>("button")).find((button) => /send/i.test(button.getAttribute("aria-label") ?? ""))!;
    await act(async () => { send.click(); await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); });
    expect(harness.liveCard?.title).toBe("Move Deal B");
    expect(harness.liveFingerprints).toEqual([]);

    await act(async () => { root.render(<PaigeAIChat hideHeader fill enableHistory soloTenantSafety clientId="client-b" />); await Promise.resolve(); });
    expect(harness.liveCard).toBeNull();
    expect(harness.liveFingerprints).toEqual([]);
    await act(async () => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
  });

  it("clears the transcript when the focused client changes", async () => {
    const fetchMock = vi.fn(async () =>
      sseResponse([`data: ${JSON.stringify({ choices: [{ delta: { content: "Client A private answer" } }] })}\n\n`, "data: [DONE]\n\n"]),
    );
    vi.stubGlobal("fetch", fetchMock);

    const { host, root } = await mount({ clientId: "client-a" });

    const textarea = host.querySelector("textarea")!;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value")!.set!;
      setter.call(textarea, "tell me about them");
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const send = Array.from(host.querySelectorAll<HTMLButtonElement>("button")).find((b) => /send/i.test(b.getAttribute("aria-label") ?? ""))!;
    await act(async () => { send.click(); await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); });

    expect(host.textContent).toContain("Client A private answer");

    // Focus moves to a different client. Nothing about client A may survive into that turn.
    await act(async () => {
      root.render(<PaigeAIChat hideHeader fill enableHistory clientId="client-b" />);
      await Promise.resolve();
    });

    expect(host.textContent).not.toContain("Client A private answer");

    await act(async () => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
  });

  it("clears the transcript when focus is cleared entirely", async () => {
    const fetchMock = vi.fn(async () =>
      sseResponse([`data: ${JSON.stringify({ choices: [{ delta: { content: "Client A private answer" } }] })}\n\n`, "data: [DONE]\n\n"]),
    );
    vi.stubGlobal("fetch", fetchMock);

    const { host, root } = await mount({ clientId: "client-a" });
    const textarea = host.querySelector("textarea")!;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value")!.set!;
      setter.call(textarea, "tell me about them");
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const send = Array.from(host.querySelectorAll<HTMLButtonElement>("button")).find((b) => /send/i.test(b.getAttribute("aria-label") ?? ""))!;
    await act(async () => { send.click(); await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); });
    expect(host.textContent).toContain("Client A private answer");

    await act(async () => {
      root.render(<PaigeAIChat hideHeader fill enableHistory clientId={null} />);
      await Promise.resolve();
    });

    expect(host.textContent).not.toContain("Client A private answer");

    await act(async () => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
  });
});

describe("PAIGE chat — a refused client scope is visible, not merely observable", () => {
  /**
   * The backend emits `{"client_scope":{"status":"refused","reason":…}}` when the named client
   * does not belong to the caller's workspace, and streams a refusal sentence. Nothing in the app
   * read that frame (zero hits repo-wide), so the surface kept asserting a focus the server had
   * denied — the code's own comment said "an advisory signal is not a control".
   *
   * Two properties, and the second is why this is not a one-liner: releasing focus changes the
   * scope epoch, which resets the transcript — so a naive fix deletes the very message the person
   * needs to read. The refusal has to survive its own consequence.
   */
  it("releases the focus the server refused, and the refusal survives the reset", async () => {
    const fetchMock = vi.fn(async () =>
      sseResponse([
        `data: ${JSON.stringify({ client_scope: { status: "refused", kind: "permission", reason: "client belongs to a different workspace" } })}\n\n`,
        `data: ${JSON.stringify({ choices: [{ delta: { content: "I couldn't confirm that this client belongs to your workspace." } }] })}\n\n`,
        "data: [DONE]\n\n",
      ]),
    );
    vi.stubGlobal("fetch", fetchMock);

    const refused = vi.fn();
    const { host, root } = await mount({ clientId: "client-foreign", onFocusRelease: refused });

    const textarea = host.querySelector("textarea")!;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value")!.set!;
      setter.call(textarea, "what's their balance");
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const send = Array.from(host.querySelectorAll<HTMLButtonElement>("button")).find((b) => /send/i.test(b.getAttribute("aria-label") ?? ""))!;
    await act(async () => { send.click(); await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); });

    // 1. The owning surface is told to let the focus go.
    expect(refused).toHaveBeenCalledWith("refused");

    // 2. That surface drops focus, which changes the scope epoch and resets the transcript.
    await act(async () => {
      root.render(<PaigeAIChat hideHeader fill enableHistory clientId={null} onFocusRelease={refused} />);
      await Promise.resolve();
    });

    // 3. The person is still told why. A reset that erases the explanation is not a fix.
    expect(host.textContent).toContain("couldn't confirm");

    await act(async () => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
  });
});

describe("PAIGE chat — a switch that lands MID-STREAM", () => {
  /**
   * THE CASE THE FIRST VERSION OF THIS FILE COULD NOT REACH, and the one that was broken.
   *
   * The reset clears the transcript. The stream is still running. Its next chunk calls
   * `setMessages([...newMessages, …])` with `newMessages` captured BEFORE the switch — so the
   * previous client's question and answer are written straight back, under the new client's scope,
   * and the next turn POSTs them. The transcript reset is only half of the isolation; the other
   * half is refusing to COMMIT a result that outlived its scope, and that half was gated behind a
   * prop this surface does not set.
   */
  it("refuses to commit a stream that outlived its scope", async () => {
    let openGate!: () => void;
    const gate = new Promise<void>((resolve) => { openGate = () => resolve(); });
    vi.stubGlobal("fetch", vi.fn(async () =>
      sseResponse(
        [
          `data: ${JSON.stringify({ choices: [{ delta: { content: "Client A private answer" } }] })}\n\n`,
          `data: ${JSON.stringify({ choices: [{ delta: { content: " — and more about A" } }] })}\n\n`,
          "data: [DONE]\n\n",
        ],
        { gateBefore: 1, gate },
      ),
    ));

    const { host, root } = await mount({ clientId: "client-a" });
    const textarea = host.querySelector("textarea")!;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value")!.set!;
      setter.call(textarea, "tell me about them");
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const send = Array.from(host.querySelectorAll<HTMLButtonElement>("button")).find((b) => /send/i.test(b.getAttribute("aria-label") ?? ""))!;
    await act(async () => { send.click(); await Promise.resolve(); await Promise.resolve(); });

    // First chunk has landed; the stream is parked before the second.
    expect(host.textContent).toContain("Client A private answer");

    // The focus changes WHILE the stream is still open.
    await act(async () => {
      root.render(<PaigeAIChat hideHeader fill enableHistory clientId="client-b" />);
      await Promise.resolve();
    });
    expect(host.textContent).not.toContain("Client A private answer");

    // Now let the rest of client A's answer arrive. It must not reach the screen.
    await act(async () => { openGate(); await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); });

    expect(host.textContent).not.toContain("Client A private answer");
    expect(host.textContent).not.toContain("and more about A");
    expect(host.textContent).not.toContain("tell me about them");

    await act(async () => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
  });
});

describe("PAIGE chat — an UNKNOWN refusal is not a permission verdict", () => {
  /**
   * The server has six refusal reasons and only two of them are answers about ownership. The other
   * four — a failed workspace RPC, a failed authority RPC, a failed authorization read, a thrown
   * exception — mean it could not find out. The handler's own comment says so.
   *
   * Before the `kind` field existed, this surface treated all six identically: it dropped the
   * operator's focused client permanently and told them Paige could not confirm the client belongs
   * to their workspace. On a transient RPC blip that is false, unactionable, and not undoable from
   * their side.
   */
  it("keeps the focus and offers a retry when the server could not check", async () => {
    vi.stubGlobal("fetch", vi.fn(async () =>
      sseResponse([
        `data: ${JSON.stringify({ client_scope: { status: "refused", kind: "unknown", reason: "client authorization read failed" } })}\n\n`,
        "data: [DONE]\n\n",
      ]),
    ));
    const refused = vi.fn();
    const { host, root } = await mount({ clientId: "client-a", onFocusRelease: refused });

    const textarea = host.querySelector("textarea")!;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value")!.set!;
      setter.call(textarea, "what's their balance");
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const send = Array.from(host.querySelectorAll<HTMLButtonElement>("button")).find((b) => /send/i.test(b.getAttribute("aria-label") ?? ""))!;
    await act(async () => { send.click(); await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); });

    // The owning surface is NOT told to drop the focus — nothing was established about ownership.
    expect(refused).not.toHaveBeenCalled();

    await act(async () => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
  });
});

describe("PAIGE chat — a parked notice cannot survive to greet an unrelated switch", () => {
  /**
   * The notice is parked on the way out of a refused scope and adopted on the way into the next
   * one. If the surface that owns focus does NOT release it — a mount that passes no
   * `onClientScopeRefused`, or focus already cleared — an unstamped notice would sit in the ref
   * indefinitely and be adopted by the next epoch change of any kind, including a WORKSPACE switch.
   * The operator would open a different workspace and be told a client there could not be
   * confirmed. Stamping it with the epoch it belongs to is what makes that impossible.
   */
  it("discards a notice nobody released, instead of carrying it into the next switch", async () => {
    vi.stubGlobal("fetch", vi.fn(async () =>
      sseResponse([
        `data: ${JSON.stringify({ client_scope: { status: "refused", kind: "permission", reason: "client belongs to a different workspace" } })}\n\n`,
        "data: [DONE]\n\n",
      ]),
    ));
    // No `onFocusRelease`: nothing releases the focus, so the notice is never adopted here.
    const { host, root } = await mount({ clientId: "client-a" });
    const textarea = host.querySelector("textarea")!;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value")!.set!;
      setter.call(textarea, "what's their balance");
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const send = Array.from(host.querySelectorAll<HTMLButtonElement>("button")).find((b) => /send/i.test(b.getAttribute("aria-label") ?? ""))!;
    await act(async () => { send.click(); await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); });

    // A LATER, UNRELATED focus change. It must not inherit the earlier refusal's explanation.
    await act(async () => {
      root.render(<PaigeAIChat hideHeader fill enableHistory clientId="client-c" />);
      await Promise.resolve();
    });
    expect(host.textContent).not.toContain("let go of that focus");

    await act(async () => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
  });
});

/**
 * #765 — FOCUSING A CLIENT MUST NOT BE UNDONE BY AN AUTOMATIC THREAD RESUME.
 *
 * The defect. Setting a client scope changes `scopeEpoch`, so the reset effect nulls
 * `hydratedFromRef` and clears `historyHydrated`. That un-gates the initial-history effect,
 * which auto-resumes `threads[0]`; `selectThread` then reaches its release line and drops the
 * focus that was set milliseconds earlier. The person never gets to send a turn under the
 * client they chose.
 *
 * Why every earlier test missed it: they all mock `threads: []`. With no saved conversation
 * there is nothing to resume, so the surface behaves correctly on an EMPTY account and fails on
 * every real one. These tests pin the populated account.
 *
 * Why the release itself is NOT removed: opening a saved owner-level thread while a client is
 * focused really must drop the focus, because that transcript may be about someone else. The
 * repair separates the person choosing a thread (still releases) from hydration restoring one
 * (must not). Written before the fix and confirmed red.
 */
describe("PAIGE chat — focusing a client survives an account that has saved conversations (#765)", () => {
  const SAVED = { id: "thread-owner-1", title: "Earlier work", updated_at: "2026-09-01T10:00:00.000Z" };
  const PRIOR = "Notes recorded about a DIFFERENT client";

  afterEach(() => {
    harness.threads = [];
    harness.loadTurns.mockReset();
    harness.loadTurns.mockImplementation(async () => []);
  });

  it("keeps the focus, and loads no saved conversation into the new client's context", async () => {
    harness.threads = [SAVED];
    harness.loadTurns.mockImplementation(async () => [{ role: "assistant", content: PRIOR }]);
    const onFocusRelease = vi.fn();

    // Owner-level first: the saved conversation IS resumed. This is the behaviour the repair
    // must preserve, so it is asserted rather than assumed.
    const { host, root } = await mount({ clientId: null, onFocusRelease, renderRail: () => null });
    expect(harness.loadTurns).toHaveBeenCalledWith(SAVED.id);
    expect(host.textContent).toContain(PRIOR);
    harness.loadTurns.mockClear();

    // The person opens PAIGE for one client from Pipeline.
    await act(async () => {
      root.render(<PaigeAIChat hideHeader fill enableHistory clientId="client-b" onFocusRelease={onFocusRelease} renderRail={() => null} />);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(onFocusRelease).not.toHaveBeenCalled();          // the focus survives
    expect(harness.loadTurns).not.toHaveBeenCalled();        // nothing was auto-resumed
    expect(host.textContent).not.toContain(PRIOR);           // no prior content carried across

    await act(async () => root.unmount());
    host.remove();
  });

  it("lets the owner send the turn they came to send, under the client they chose", async () => {
    harness.threads = [SAVED];
    harness.loadTurns.mockImplementation(async () => [{ role: "assistant", content: PRIOR }]);
    // Typed with its arguments so the assertion below can read the request body. An untyped
    // `vi.fn(async () => …)` gives `mock.calls` an empty-tuple element type, which typechecks
    // as "no argument at index 1" — caught by the tsc ratchet, not by the test run.
    const fetchMock = vi.fn(async (_url: string, _init: RequestInit) =>
      sseResponse([`data: ${JSON.stringify({ choices: [{ delta: { content: "One recorded outcome." } }] })}\n\n`, "data: [DONE]\n\n"]),
    );
    vi.stubGlobal("fetch", fetchMock);

    const onFocusRelease = vi.fn();
    const { host, root } = await mount({ clientId: "client-b", onFocusRelease, renderRail: () => null });
    // Stated explicitly so this test cannot pass for the wrong reason. The real parents
    // (`PaigeWorkspace.clearFocus`, `SoloPaigeWorkspace.releaseScope`) DO clear on release, and
    // the resulting epoch change would wipe the transcript — so the production symptom of #765
    // is a lost focus, not a leaked payload. This asserts the focus was never released at all,
    // rather than relying on a no-op parent to leave the stale transcript in place.
    expect(onFocusRelease).not.toHaveBeenCalled();

    const textarea = host.querySelector("textarea")!;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value")!.set!;
      setter.call(textarea, "what do the records prove");
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const send = Array.from(host.querySelectorAll<HTMLButtonElement>("button")).find((b) => /send/i.test(b.getAttribute("aria-label") ?? ""))!;
    await act(async () => { send.click(); await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); });

    expect(host.textContent).toContain("One recorded outcome.");
    // The turn went out under the chosen client, and carried none of the saved conversation.
    const firstCall = fetchMock.mock.calls[0];
    expect(firstCall).toBeDefined();
    const body = JSON.parse(String(firstCall![1].body));
    expect(body.clientId).toBe("client-b");
    expect(JSON.stringify(body.messages)).not.toContain(PRIOR);

    await act(async () => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
  });

  it("still releases the focus when the PERSON opens a saved conversation", async () => {
    harness.threads = [SAVED];
    harness.loadTurns.mockImplementation(async () => [{ role: "assistant", content: PRIOR }]);
    const onFocusRelease = vi.fn();
    let rail: { onSelect: (id: string) => void } | null = null;

    const { host, root } = await mount({
      clientId: "client-b",
      onFocusRelease,
      renderRail: (api: { onSelect: (id: string) => void }) => { rail = api; return null; },
    });
    expect(onFocusRelease).not.toHaveBeenCalled();

    // A deliberate act by the person, not hydration. This one MUST still release, because the
    // transcript it opens is owner-level and may be about a different client.
    await act(async () => { rail!.onSelect(SAVED.id); await Promise.resolve(); await Promise.resolve(); });
    expect(onFocusRelease).toHaveBeenCalledWith("thread_resumed");

    // The real parents (`PaigeWorkspace.clearFocus`, `SoloPaigeWorkspace.releaseScope`) actually
    // drop the focus, so the epoch moves. Driven here rather than left to a no-op spy, because a
    // spy that never changes the props tests a parent this app does not have.
    await act(async () => {
      root.render(<PaigeAIChat hideHeader fill enableHistory clientId={null} onFocusRelease={onFocusRelease} renderRail={() => null} />);
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(onFocusRelease).toHaveBeenCalledTimes(1);

    // WHICH transcript is showing after that release is deliberately NOT asserted here. The
    // release invalidates the request fence mid-load, so the clicked thread can lose to the
    // newest one — a separate, pre-existing defect filed as its own issue, not repaired by #765.

    await act(async () => root.unmount());
    host.remove();
  });

  it("does not let the auto-resume erase the refusal the person needs to read", async () => {
    // The refusal path RELEASES focus, which changes the epoch, which re-arms this same
    // auto-resume — and the resumed thread overwrites the parked explanation. The existing
    // refusal test passes only because it inherits `threads: []`. Populate the account and
    // the whole `pendingScopeNoticeRef` mechanism is inert, which is every real account.
    harness.threads = [SAVED];
    harness.loadTurns.mockImplementation(async () => [{ role: "assistant", content: PRIOR }]);
    const fetchMock = vi.fn(async () =>
      sseResponse([
        `data: ${JSON.stringify({ client_scope: { status: "refused", kind: "permission", reason: "client belongs to a different workspace" } })}\n\n`,
        `data: ${JSON.stringify({ choices: [{ delta: { content: "I couldn't confirm that this client belongs to your workspace." } }] })}\n\n`,
        "data: [DONE]\n\n",
      ]),
    );
    vi.stubGlobal("fetch", fetchMock);

    const refused = vi.fn();
    const { host, root } = await mount({ clientId: "client-foreign", onFocusRelease: refused, renderRail: () => null });

    const textarea = host.querySelector("textarea")!;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value")!.set!;
      setter.call(textarea, "what's their balance");
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const send = Array.from(host.querySelectorAll<HTMLButtonElement>("button")).find((b) => /send/i.test(b.getAttribute("aria-label") ?? ""))!;
    await act(async () => { send.click(); await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); });
    expect(refused).toHaveBeenCalledWith("refused");

    // The surface drops the focus the server denied.
    await act(async () => {
      root.render(<PaigeAIChat hideHeader fill enableHistory clientId={null} onFocusRelease={refused} renderRail={() => null} />);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(host.textContent).toContain("couldn't confirm");   // the explanation survives
    expect(host.textContent).not.toContain(PRIOR);            // nothing resumed over it

    await act(async () => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
  });

  it("opens the conversation the person actually clicked, not merely the newest one", async () => {
    // The release at the top of `selectThread` changes the epoch, which invalidates the very
    // load that release was made for — so the clicked thread is discarded and the re-armed
    // hydration resumes `threads[0]` instead. Before #765 this was nearly unreachable, because
    // a focus never survived long enough to click a thread under it. The repair makes it the
    // normal state, so it has to be repaired with it rather than after it.
    const NEWEST = { id: "thread-newest", title: "Newest", updated_at: "2026-09-02T10:00:00.000Z" };
    const OLDER = { id: "thread-older", title: "Q3 renewal notes", updated_at: "2026-08-01T10:00:00.000Z" };
    harness.threads = [NEWEST, OLDER];
    harness.loadTurns.mockImplementation(async (id: string) => [
      { role: "assistant", content: id === OLDER.id ? "THE OLDER CONVERSATION" : "THE NEWEST CONVERSATION" },
    ]);
    const onFocusRelease = vi.fn();
    let rail: { onSelect: (id: string) => void } | null = null;

    const { host, root } = await mount({
      clientId: "client-b",
      onFocusRelease,
      renderRail: (api: { onSelect: (id: string) => void }) => { rail = api; return null; },
    });

    await act(async () => { rail!.onSelect(OLDER.id); await Promise.resolve(); await Promise.resolve(); });
    expect(onFocusRelease).toHaveBeenCalledWith("thread_resumed");

    // The real parent drops the focus, which is what invalidates the in-flight load.
    await act(async () => {
      root.render(<PaigeAIChat hideHeader fill enableHistory clientId={null} onFocusRelease={onFocusRelease} renderRail={() => null} />);
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(host.textContent).toContain("THE OLDER CONVERSATION");
    expect(host.textContent).not.toContain("THE NEWEST CONVERSATION");

    await act(async () => root.unmount());
    host.remove();
  });

  it("resumes the owner's history again once the focus is cleared", async () => {
    harness.threads = [SAVED];
    harness.loadTurns.mockImplementation(async () => [{ role: "assistant", content: PRIOR }]);

    const { host, root } = await mount({ clientId: "client-b", onFocusRelease: vi.fn(), renderRail: () => null });
    expect(harness.loadTurns).not.toHaveBeenCalled();

    await act(async () => {
      root.render(<PaigeAIChat hideHeader fill enableHistory clientId={null} onFocusRelease={vi.fn()} renderRail={() => null} />);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(harness.loadTurns).toHaveBeenCalledWith(SAVED.id);
    expect(host.textContent).toContain(PRIOR);

    await act(async () => root.unmount());
    host.remove();
  });
});

/**
 * The SOLO configuration, pinned rather than inferred. `SoloPaigeWorkspace` is the surface the
 * Pipeline "Open PAIGE for this client" control actually reaches, and it mounts with
 * `soloTenantSafety` set — under which `selectThread` takes different branches. #765 must hold
 * here too, or the repair is proven on one of the two client-focusing surfaces only.
 */
describe("PAIGE chat — #765 holds on the Solo mount, with soloTenantSafety set", () => {
  const SAVED = { id: "thread-owner-1", title: "Earlier work", updated_at: "2026-09-01T10:00:00.000Z" };
  const PRIOR = "Notes recorded about a DIFFERENT client";

  afterEach(() => {
    harness.threads = [];
    harness.loadTurns.mockReset();
    harness.loadTurns.mockImplementation(async () => []);
  });

  it("keeps the focus and resumes nothing, exactly as on the unflagged mount", async () => {
    harness.threads = [SAVED];
    harness.loadTurns.mockImplementation(async () => [{ role: "assistant", content: PRIOR }]);
    const onFocusRelease = vi.fn();

    const { host, root } = await mount({ soloTenantSafety: true, clientId: "client-b", onFocusRelease, renderRail: () => null });

    expect(onFocusRelease).not.toHaveBeenCalled();
    expect(harness.loadTurns).not.toHaveBeenCalled();
    expect(host.textContent).not.toContain(PRIOR);
    // Not stranded: the composer is usable, so the owner can send the turn they came to send.
    expect(host.querySelector("textarea")).not.toBeNull();

    await act(async () => root.unmount());
    host.remove();
  });
});

describe("PAIGE chat — durable document reconnect", () => {
  const SAVED = { id: "thread-durable", title: "Agreement draft", updated_at: "2026-09-23T10:00:00.000Z" };

  afterEach(() => {
    harness.threads = [];
    harness.loadTurns.mockReset();
    harness.loadTurns.mockImplementation(async () => []);
  });

  it("reconstructs the persisted artifact card from the completion turn after reconnect", async () => {
    harness.threads = [SAVED];
    harness.loadTurns.mockImplementation(async () => [{
      id: "turn-complete",
      created_at: "2026-09-23T10:01:00.000Z",
      role: "assistant",
      content: "Your document is ready: Services Agreement Draft.",
      bundle_ref: {
        paige_artifact: [{
          id: "00000000-0000-4000-8000-000000000101",
          title: "Services Agreement Draft",
          artifactType: "document",
          tenant_id: "account-a",
        }],
      },
    }]);

    const { host, root } = await mount({ clientId: null, renderRail: () => null });
    expect(harness.loadTurns).toHaveBeenCalledWith(SAVED.id);
    expect(host.querySelector('[data-testid="artifact-00000000-0000-4000-8000-000000000101"]')?.textContent)
      .toBe("account-a:Services Agreement Draft");

    await act(async () => root.unmount());
    host.remove();
  });
});

/**
 * STATIC assertion, and labelled as such (§13). `WorkspaceBody` is not exported and has no render
 * harness in this repository, so this pins the rule at source level only — it proves the cleanup
 * is present, not that it runs. A render test is owed if that surface ever gets a harness.
 */
describe("PaigeWorkspace — a focus belongs to an account (#765 regression guard)", () => {
  it("clears the focused client when the account changes", () => {
    const src = readFileSync("src/components/paige/PaigeWorkspace.tsx", "utf8");
    // Before #765 this was cleared by accident, because the account switch re-armed the history
    // resume and `selectThread` released the focus on its way past. Skipping that resume is the
    // correct repair, so the cleanup must now be deliberate — and must not be quietly removed.
    expect(src).toContain("useEffect(() => { setFocusedClient(null); }, [activeTenantId]);");
  });
});
