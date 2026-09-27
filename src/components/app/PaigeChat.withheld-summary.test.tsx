import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// R3 — when the server withholds an answer it sends one fixed sentence and a `paige_withheld` frame.
// The portal keeps a summary of each document read this session and sends it back on later turns; a
// withheld sentence is not an account of the document, so it must never become that summary.

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

class NoopResizeObserver implements ResizeObserver {
  disconnect() {}
  observe() {}
  unobserve() {}
}
vi.stubGlobal("ResizeObserver", NoopResizeObserver);

const extractDocumentSummary = vi.fn();
const DOC = { name: "intake.pdf", base64: "JVBERi0xLjQK" };

vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual<typeof import("react-router-dom")>("react-router-dom");
  return { ...actual, useNavigate: () => vi.fn(), useLocation: () => ({ pathname: "/app" }) };
});
vi.mock("@tanstack/react-query", async () => {
  const actual = await vi.importActual<typeof import("@tanstack/react-query")>("@tanstack/react-query");
  return { ...actual, useQueryClient: () => ({ invalidateQueries: vi.fn() }) };
});
vi.mock("@/hooks/use-mobile", () => ({ useIsMobile: () => false }));
vi.mock("@/lib/playbook", () => ({
  usePlaybook: () => ({ persona: { greeting: "Harness greeting", name: "Paige", role: "AI COO" }, quickActions: [] }),
}));
vi.mock("@/hooks/useClientPortalBrand", () => ({ useClientPortalBrandState: () => ({ brand: null, loading: false }) }));
vi.mock("@/hooks/useClientChatContext", () => ({
  useClientChatContext: () => ({ contextBlock: "", isLoading: false, hasCreditData: false }),
}));
vi.mock("@/hooks/useProfileSnapshot", () => ({ useProfileSnapshot: () => ({ snapshot: {}, refresh: vi.fn() }) }));
vi.mock("@/hooks/useBeforeUnloadGuard", () => ({ useBeforeUnloadGuard: () => undefined }));
vi.mock("@/hooks/useAnalytics", () => ({ trackEvent: vi.fn() }));
vi.mock("@/hooks/usePaigeMemory", () => ({
  usePaigeMemory: () => ({
    extractDocumentSummary, getSessionDocumentContext: vi.fn(() => undefined), trackActivity: vi.fn(),
    generateSessionSummary: vi.fn(), resetSession: vi.fn(),
  }),
}));
vi.mock("@/hooks/useChatDocumentUpload", () => ({
  useChatDocumentUpload: () => ({
    attachedDoc: DOC, isProcessingFile: false, isDragOver: false, fileInputRef: { current: null },
    handleFileSelect: vi.fn(), handleDragOver: vi.fn(), handleDragLeave: vi.fn(), handleDrop: vi.fn(),
    removeAttachment: vi.fn(), openFilePicker: vi.fn(), setAttachedDoc: vi.fn(),
  }),
}));
vi.mock("@/components/voice/DictationMicButton", () => ({ DictationMicButton: () => <button type="button">Dictate</button> }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: { getSession: vi.fn(async () => ({ data: { session: { access_token: "test-token", user: { id: "client-a" } } } })) },
    functions: { invoke: vi.fn() },
  },
}));

import { PaigeChat } from "./PaigeChat";

const SENTENCE = "I wrote an answer, but it included internal system details that aren't meant to be shared here, so I didn't send it. I won't guess at a different answer. You can ask me another way, or ask Northside Fitness directly.";
const ANSWER = "Got it — I've read your intake form. It lists your goals for the first month, your availability on weekday mornings, and two past injuries to plan around.";

const frame = (payload: unknown) => `data: ${JSON.stringify(payload)}\n\n`;
function streamOf(text: string): Response {
  return new Response(new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(text));
      controller.close();
    },
  }), { status: 200, headers: { "Content-Type": "text/event-stream" } });
}

/** Answers the greeting with a short line and the document turn with `turnBody`. */
function serve(turnBody: string) {
  return vi.fn(async (_url: string, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body ?? "{}"));
    if (!body.document) return streamOf(frame({ choices: [{ delta: { content: "Hi there." } }] }) + "data: [DONE]\n\n");
    return streamOf(turnBody);
  });
}

describe("the portal never keeps a withheld sentence as a document's summary", () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    sessionStorage.clear();
    extractDocumentSummary.mockReset();
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
    vi.stubGlobal("ResizeObserver", NoopResizeObserver);
  });

  async function sendDocumentTurn(turnBody: string) {
    const fetchMock = serve(turnBody);
    vi.stubGlobal("fetch", fetchMock);
    await act(async () => root.render(<PaigeChat user={{ id: "client-a", user_metadata: {} } as never} session={null} />));
    const send = [...host.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.className.includes("bg-gradient-gold"))!;
    await act(async () => {
      send.click();
      for (let i = 0; i < 20; i += 1) await new Promise((r) => setTimeout(r, 0));
    });
    return fetchMock;
  }

  it("CONTROL: a delivered answer about the document is kept as its summary", async () => {
    const fetchMock = await sendDocumentTurn(frame({ choices: [{ delta: { content: ANSWER } }] }) + "data: [DONE]\n\n");
    expect(fetchMock.mock.calls.some(([, init]) => String((init as RequestInit)?.body).includes('"document"'))).toBe(true);
    expect(host.textContent).toContain(ANSWER);
    expect(extractDocumentSummary).toHaveBeenCalledWith(ANSWER, DOC.name);
  });

  it("a withheld answer shows the sentence and is never kept as the document's summary", async () => {
    await sendDocumentTurn(frame({ paige_withheld: true }) + frame({ choices: [{ delta: { content: SENTENCE } }] }) + "data: [DONE]\n\n");
    expect(host.textContent).toContain(SENTENCE);
    expect(extractDocumentSummary).not.toHaveBeenCalled();
  });
});
