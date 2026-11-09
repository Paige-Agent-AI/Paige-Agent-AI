import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OriginalDocumentWork } from "./OriginalDocumentWork";

const { getSession, invoke } = vi.hoisted(() => ({ getSession: vi.fn(), invoke: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { auth: { getSession }, functions: { invoke } } }));
vi.mock("@/components/paige/chat/PaigeArtifactCard", () => ({
  PaigeArtifactCard: ({ artifact }: { artifact: { id: string } }) => <span>{artifact.id}</span>,
}));

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const reference = { threadId: id(1), intentId: id(2), workId: id(3) };
const completion = { resultRef: id(4), receiptRef: id(5) };
const response = { error: null, data: { durable_work: {
  ...reference, state: "succeeded", version: 3, recoveryState: "observed",
  artifactVerified: true, artifactRef: completion.resultRef,
  continuation: { workId: reference.workId, eligibleForContext: true,
    reason: "canonical_terminal", state: "succeeded", completion },
} } };

describe("original document status control", () => {
  let host: HTMLDivElement;
  let root: Root;
  let active: boolean;
  beforeEach(() => {
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    active = true;
    invoke.mockReset();
    getSession.mockReset().mockResolvedValue({ data: { session: { user: { id: id(6) }, access_token: "fixture" } } });
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
  });

  async function open(key: string) {
    await act(async () => root.render(<OriginalDocumentWork key={key} reference={reference}
      actorId={id(6)} tenantId={id(7)} current={() => active} artifacts={[]} />));
  }

  it("recovers the same result and receipt through one read per explicit check after reopening", async () => {
    invoke.mockResolvedValue(response);
    await open("first");
    expect(invoke).not.toHaveBeenCalled();
    await act(async () => {
      host.querySelector("button")!.click();
      host.querySelector("button")!.click();
    });
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(invoke.mock.calls[0][1].body).toEqual({
      threadId: reference.threadId, requestIntentId: reference.intentId,
      messages: [{ role: "user", content: "Status" }],
      interactive: { kind: "status", workId: reference.workId },
    });
    expect(host.textContent).toContain(completion.receiptRef);
    expect(host.textContent).toContain(completion.resultRef);
    await open("reopened");
    expect(host.textContent).not.toContain(completion.receiptRef);
    await act(async () => host.querySelector("button")!.click());
    expect(invoke).toHaveBeenCalledTimes(2);
    expect(host.textContent).toContain(completion.receiptRef);
    expect(host.textContent).toContain(completion.resultRef);
  });

  it("aborts and withholds the old result when the conversation is replaced during the read", async () => {
    let settle!: (value: typeof response) => void;
    invoke.mockImplementation(() => new Promise(resolve => { settle = resolve; }));
    await open("first");
    await act(async () => host.querySelector("button")!.click());
    const signal = invoke.mock.calls[0][1].signal as AbortSignal;
    await open("other-conversation");
    expect(signal.aborted).toBe(true);
    await act(async () => settle(response));
    expect(host.textContent).not.toContain(completion.receiptRef);
    expect(invoke).toHaveBeenCalledTimes(1);
  });
});
