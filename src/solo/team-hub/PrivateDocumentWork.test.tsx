import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OriginalDocumentWork } from "@/components/chat/OriginalDocumentWork";
import {
  clearPrivateDocumentWork,
  keepPrivateDocumentWork,
  privateDocumentWorkSnapshot,
} from "@/lib/privateDocumentWorkHandoff";
import { CHAT_CONTROL_HEADER } from "../../../supabase/functions/_shared/paige-turn/control-transport";
import { PrivateDocumentWork } from "./PrivateDocumentWork";

const { invoke, getSession } = vi.hoisted(() => ({ invoke: vi.fn(), getSession: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { auth: { getSession }, functions: { invoke } },
}));
vi.mock("@/components/paige/chat/PaigeArtifactCard", () => ({
  PaigeArtifactCard: ({ artifact }: { artifact: { id: string } }) => <div data-document={artifact.id} />,
}));

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const actorId = id(1);
const tenantId = id(2);
const reference = { threadId: id(3), intentId: id(4), workId: id(5) };
const completion = { resultRef: id(6), receiptRef: id(7) };
const response = {
  error: null,
  data: { durable_work: {
    ...reference, version: 3, state: "succeeded", recoveryState: "observed",
    artifactVerified: true, artifactRef: completion.resultRef,
    continuation: {
      workId: reference.workId, eligibleForContext: true, reason: "canonical_terminal",
      state: "succeeded", completion,
    },
  } },
};
const session = (userId: string) => ({ data: { session: { user: { id: userId }, access_token: "caller-token" } } });

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  window.sessionStorage.clear();
  getSession.mockReset().mockResolvedValue(session(actorId));
  invoke.mockReset().mockResolvedValue(response);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

async function open(actor = actorId, tenant = tenantId) {
  await act(async () => root.render(<PrivateDocumentWork key={`${actor}:${tenant}`} actorId={actor} tenantId={tenant} />));
  await act(async () => {
    const details = host.querySelector("details")!;
    details.open = true;
    details.dispatchEvent(new Event("toggle", { bubbles: true }));
  });
}

function button(text: string) {
  return [...host.querySelectorAll("button")].find(element => element.textContent?.trim() === text);
}

async function check() {
  await act(async () => button("Check original document status")!.click());
}

describe("Team Hub private document reopen", () => {
  it("keeps only the explicit locator and restores the same result and receipt after a remount", async () => {
    const source = { ...reference, transcript: "private context", ...completion };
    await act(async () => root.render(
      <OriginalDocumentWork reference={source} actorId={actorId} tenantId={tenantId} current={() => true} artifacts={[]} />,
    ));
    expect(button("Keep in Team Hub")).toBeUndefined();
    await check();
    expect(privateDocumentWorkSnapshot(actorId, tenantId)).toBeNull();
    await act(async () => button("Keep in Team Hub")!.click());
    expect(host.textContent).toContain("In Team Hub, open Saved PAIGE work.");
    expect(privateDocumentWorkSnapshot(actorId, tenantId)).toBe(JSON.stringify(reference));
    expect(invoke).toHaveBeenCalledTimes(1);

    for (let visit = 0; visit < 2; visit++) {
      await open();
      expect(host.textContent).not.toContain(completion.receiptRef);
      expect(invoke).toHaveBeenCalledTimes(visit + 1);
      await check();
      expect(invoke).toHaveBeenLastCalledWith("paige-ai-chat", expect.objectContaining({
        headers: { [CHAT_CONTROL_HEADER]: "status", Authorization: "Bearer caller-token" },
        body: {
          threadId: reference.threadId, requestIntentId: reference.intentId,
          messages: [{ role: "user", content: "Status" }],
          interactive: { kind: "status", workId: reference.workId },
        },
      }));
      expect(host.textContent).toContain(completion.receiptRef);
      expect(host.querySelector("[data-document]")?.getAttribute("data-document")).toBe(completion.resultRef);
      expect(button("Keep in Team Hub")).toBeUndefined();
      await act(async () => root.render(null));
    }
    expect(invoke).toHaveBeenCalledTimes(3);
  });

  it("does not save a verified Chat reference once its original scope has retired", async () => {
    let current = true;
    await act(async () => root.render(
      <OriginalDocumentWork reference={reference} actorId={actorId} tenantId={tenantId} current={() => current} artifacts={[]} />,
    ));
    await check();
    current = false;
    await act(async () => button("Keep in Team Hub")!.click());
    expect(privateDocumentWorkSnapshot(actorId, tenantId)).toBeNull();
    expect(invoke).toHaveBeenCalledTimes(1);
  });

  it("keeps a different actor and workspace from seeing or checking the saved reference", async () => {
    keepPrivateDocumentWork(actorId, tenantId, reference);
    for (const [actor, tenant] of [[id(8), tenantId], [actorId, id(9)]]) {
      await open(actor, tenant);
      expect(button("Check original document status")).toBeUndefined();
    }
    expect(invoke).not.toHaveBeenCalled();
    await open();
    getSession.mockResolvedValue(session(id(8)));
    await check();
    expect(invoke).not.toHaveBeenCalled();
    expect(host.textContent).toContain("could not be verified");
  });

  it("withholds evidence when the original reader denies access or returns a different Work", async () => {
    keepPrivateDocumentWork(actorId, tenantId, reference);
    await open();
    invoke.mockResolvedValueOnce({ data: null, error: { context: { status: 403 } } })
      .mockResolvedValueOnce({ ...response, data: { durable_work: { ...response.data.durable_work, workId: id(8) } } });
    for (let read = 0; read < 2; read++) {
      await check();
      expect(host.textContent).toContain("could not be verified");
      expect(host.textContent).not.toContain(completion.receiptRef);
      expect(host.querySelector("[data-document]")).toBeNull();
    }
  });

  it("retires a pending read when the locator is removed and refuses to clear a replacement", async () => {
    keepPrivateDocumentWork(actorId, tenantId, reference);
    await open();
    let settle!: (value: typeof response) => void;
    invoke.mockReturnValueOnce(new Promise(resolve => { settle = resolve; }));
    await check();
    const signal = invoke.mock.calls[0][1].signal as AbortSignal;
    const stale = privateDocumentWorkSnapshot(actorId, tenantId)!;
    await act(async () => button("Remove saved reference")!.click());
    expect(signal.aborted).toBe(true);
    expect(privateDocumentWorkSnapshot(actorId, tenantId)).toBeNull();
    expect(document.activeElement?.tagName).toBe("SUMMARY");
    await act(async () => settle(response));
    expect(host.textContent).not.toContain(completion.receiptRef);
    await act(async () => {
      keepPrivateDocumentWork(actorId, tenantId, { ...reference, workId: id(8) });
    });
    expect(clearPrivateDocumentWork(actorId, tenantId, stale)).toBe(false);
    expect(button("Check original document status")).toBeDefined();
  });
});
