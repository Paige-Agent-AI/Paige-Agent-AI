import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const resizeCallbacks: Array<ResizeObserverCallback> = [];

class HarnessResizeObserver implements ResizeObserver {
  constructor(callback: ResizeObserverCallback) { resizeCallbacks.push(callback); }
  disconnect() {}
  observe() {}
  unobserve() {}
}

vi.stubGlobal("ResizeObserver", HarnessResizeObserver);
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
const portalFixture=vi.hoisted(()=>({phase:"not-client",frame:null as unknown,checking:false,
  read:vi.fn(),reload:vi.fn(),summary:vi.fn()}));
vi.mock("@/hooks/useClientPortalFrame", () => ({useClientPortalFrame: () => portalFixture}));
vi.mock("@/lib/customer-chat",()=>({readCustomerChat:(...args:unknown[])=>portalFixture.read(...args)}));
vi.mock("@/hooks/useClientPortalBrand", () => ({ useClientPortalBrandState: () => ({ brand: null, loading: false }) }));
vi.mock("@/hooks/useClientChatContext", () => ({
  useClientChatContext: () => ({ contextBlock: "", isLoading: false, hasCreditData: false }),
}));
vi.mock("@/hooks/useProfileSnapshot", () => ({ useProfileSnapshot: () => ({ snapshot: {}, refresh: vi.fn() }) }));
vi.mock("@/hooks/useBeforeUnloadGuard", () => ({ useBeforeUnloadGuard: () => undefined }));
vi.mock("@/hooks/useAnalytics", () => ({ trackEvent: vi.fn() }));
vi.mock("@/hooks/usePaigeMemory", () => ({
  usePaigeMemory: () => ({
    extractDocumentSummary: vi.fn(), getSessionDocumentContext: vi.fn(() => ""), trackActivity: vi.fn(),
    generateSessionSummary: portalFixture.summary, resetSession: vi.fn(),
  }),
}));
vi.mock("@/hooks/useChatDocumentUpload", () => ({
  useChatDocumentUpload: () => ({
    attachedDoc: null, isProcessingFile: false, isDragOver: false, fileInputRef: { current: null },
    handleFileSelect: vi.fn(), handleDragOver: vi.fn(), handleDragLeave: vi.fn(), handleDrop: vi.fn(),
    removeAttachment: vi.fn(), openFilePicker: vi.fn(), setAttachedDoc: vi.fn(),
  }),
}));
vi.mock("@/components/voice/DictationMicButton", () => ({ DictationMicButton: () => <button type="button">Dictate</button> }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { auth: { getSession: vi.fn(async () => ({ data: { session: null } })) }, functions: { invoke: vi.fn() } },
}));

import { PaigeChat } from "./PaigeChat";

function setGeometry(transcript: HTMLDivElement, scrollHeight: { value: number }) {
  Object.defineProperties(transcript, {
    clientHeight: { configurable: true, get: () => 300 },
    scrollHeight: { configurable: true, get: () => scrollHeight.value },
    scrollTo: {
      configurable: true,
      value: ({ top }: ScrollToOptions) => { transcript.scrollTop = Math.min(Number(top), scrollHeight.value - 300); },
    },
  });
  transcript.getBoundingClientRect = () => ({
    x: 0, y: 0, left: 0, right: 600, top: 0, bottom: 300,
    width: 600, height: 300, toJSON: () => ({}),
  });
  const message = transcript.querySelector<HTMLElement>("[data-paige-message-id]")!;
  message.getBoundingClientRect = () => ({
    x: 0, y: -transcript.scrollTop, left: 0, right: 600, top: -transcript.scrollTop,
    bottom: scrollHeight.value - transcript.scrollTop, width: 600, height: scrollHeight.value, toJSON: () => ({}),
  });
}

describe("normal PaigeChat remount scroll behavior", () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    portalFixture.phase="not-client";portalFixture.frame=null;portalFixture.checking=false;
    portalFixture.read.mockReset();portalFixture.summary.mockClear();
    sessionStorage.clear();
    resizeCallbacks.length = 0;
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    sessionStorage.clear();
  });

  it("does not inherit an unresolvable anchor after remount and follows subsequent growth", async () => {
    const props = { user: { id: "owner-a", user_metadata: {} } as never, session: null };
    await act(async () => root.render(<PaigeChat {...props} />));
    const first = host.querySelector<HTMLDivElement>("[data-paige-transcript-scroll=true]")!;
    const firstHeight = { value: 1_200 };
    setGeometry(first, firstHeight);
    const firstId = first.querySelector<HTMLElement>("[data-paige-message-id]")!.dataset.paigeMessageId;
    first.dispatchEvent(new WheelEvent("wheel"));
    first.scrollTop = 425;
    first.dispatchEvent(new Event("scroll", { bubbles: true }));

    await act(async () => root.unmount());
    root = createRoot(host);
    await act(async () => root.render(<PaigeChat {...props} />));
    const remount = host.querySelector<HTMLDivElement>("[data-paige-transcript-scroll=true]")!;
    const remountHeight = { value: 1_200 };
    setGeometry(remount, remountHeight);
    const remountId = remount.querySelector<HTMLElement>("[data-paige-message-id]")!.dataset.paigeMessageId;
    expect(remountId).not.toBe(firstId);

    await act(async () => {
      for (const callback of resizeCallbacks) callback([], {} as ResizeObserver);
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    });
    expect(remount.scrollTop).toBe(900);

    await act(async () => window.dispatchEvent(new Event("paige-factory-reset")));
    expect(remount.scrollTop).toBe(900);

    remountHeight.value = 1_350;
    await act(async () => {
      for (const callback of resizeCallbacks) callback([], {} as ResizeObserver);
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    });
    expect(remount.scrollTop).toBe(1_050);
  });

  it("hydrates canonical customer history and keeps the same draft concealed during a session recheck",async()=>{
    const actor="e0915000-0000-4000-8000-000000000001";
    portalFixture.phase="ready";
    portalFixture.frame={actorId:actor,profile:{id:"e0935000-0000-4000-8000-000000000001",
      tenant_id:"e0925000-0000-4000-8000-000000000001"},
      brand:{tenant_name:"Test customer practice",logo_url:null,primary_color:null},config:{}};
    portalFixture.read.mockResolvedValue({threadId:"e0945000-0000-4000-8000-000000000001",
      messages:[{id:"e0955000-0000-4000-8000-000000000001",role:"user",content:"Saved private question"},
        {id:"e0955000-0000-4000-8000-000000000002",role:"assistant",content:"Saved private answer"}]});
    const props={user:{id:actor,user_metadata:{}} as never,session:null};
    await act(async()=>{root.render(<PaigeChat {...props}/>);for(let i=0;i<30;i++)await Promise.resolve();});
    expect(host.textContent).toContain("Saved private answer");
    expect(host.textContent).toContain("AI assistant for Test customer practice");
    expect(host.querySelector('[data-paige-message-id="e0955000-0000-4000-8000-000000000002"]')).not.toBeNull();
    const input=host.querySelector("textarea")!;
    await act(async()=>{
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,"value")!.set!.call(input,"My unsent private draft");
      input.dispatchEvent(new Event("input",{bubbles:true}));
    });
    portalFixture.checking=true;
    await act(async()=>root.render(<PaigeChat {...props}/>));
    expect(host.querySelector("textarea")).toBe(input);
    expect(input.value).toBe("My unsent private draft");
    expect(host.querySelector("[inert]")).not.toBeNull();
    expect(host.textContent).toContain("Checking your conversation");
    portalFixture.checking=false;
    await act(async()=>{root.render(<PaigeChat {...props}/>);for(let i=0;i<30;i++)await Promise.resolve();});
    expect(host.querySelector("textarea")).toBe(input);
    expect(input.value).toBe("My unsent private draft");
    expect(portalFixture.summary).not.toHaveBeenCalled();
  });

  it("retires private customer text when relationship access is lost",async()=>{
    const props={user:{id:"customer-test",user_metadata:{}} as never,session:null};
    portalFixture.phase="ready";
    portalFixture.frame={actorId:"customer-test",profile:{id:"customer-contact",tenant_id:"customer-business"},
      brand:{tenant_name:"Test practice"},config:{}};
    portalFixture.read.mockResolvedValue({threadId:"private-thread",
      messages:[{id:"private-message",role:"assistant",content:"Customer-private saved answer"}]});
    await act(async()=>{root.render(<PaigeChat {...props}/>);for(let i=0;i<30;i++)await Promise.resolve();});
    expect(host.textContent).toContain("Customer-private saved answer");
    portalFixture.phase="unavailable";portalFixture.frame=null;
    await act(async()=>root.render(<PaigeChat {...props}/>));
    expect(host.textContent).not.toContain("Customer-private saved answer");
    expect(host.textContent).toContain("customer access is no longer available");
    expect(host.querySelector("textarea")).toBeNull();
  });
});
