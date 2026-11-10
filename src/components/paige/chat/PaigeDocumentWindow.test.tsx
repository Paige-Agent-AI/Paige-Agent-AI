import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PaigeDocumentWindowHost } from "./PaigeDocumentWindow";
import { usePaigeDocumentWindow } from "./paigeDocumentWindowContext";

const fake = vi.hoisted(() => ({ session: vi.fn(), read: vi.fn(), eq: vi.fn(), abort: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: { getSession: fake.session },
    from: () => {
      const query = {
        select: () => query,
        eq: (...args: unknown[]) => { fake.eq(...args); return query; },
        abortSignal: (signal: AbortSignal) => { fake.abort(signal); return query; },
        maybeSingle: () => ({ overrideTypes: fake.read }),
      };
      return query;
    },
  },
}));
vi.mock("@/components/admin/studio/studio-document", () => ({
  parseStudioDocument: (id: string, title: string, body: string) => ({ id, title, body }),
}));
vi.mock("@/components/admin/studio/DocumentPreview", () => ({
  DocumentPreview: ({ document }: { document: { body: string } }) => <article>{document.body}</article>,
}));

const scope = { key: "actor:tenant:chat", actorId: "actor", tenantId: "tenant" };
const target = { id: "document", tenantId: "tenant", title: "Original document" };
const saved = { error: null, data: { id: "document", title: "Office Plant Checklist", kind: "document",
  body: "Check soil on Monday.", document_revision: 1 } };

function Card({ document = target }: { document?: typeof target }) {
  const open = usePaigeDocumentWindow();
  return <button onClick={event => open?.(document, event.currentTarget)}>Open</button>;
}

describe("saved document window", () => {
  let host: HTMLElement;
  let root: Root;
  let wide: boolean;
  let digest: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    wide = true;
    fake.session.mockReset().mockResolvedValue({ data: { session: { user: { id: scope.actorId } } } });
    fake.read.mockReset().mockResolvedValue(saved);
    fake.eq.mockClear();
    fake.abort.mockClear();
    digest = vi.fn(async (_algorithm, bytes: Uint8Array) => Uint8Array.of(bytes.length).buffer);
    vi.stubGlobal("crypto", { subtle: { digest } });
    vi.stubGlobal("matchMedia", (query: string) => ({
      matches: query.includes("min-width") && wide, addEventListener: vi.fn(), removeEventListener: vi.fn(),
    }));
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
  });

  const button = (label: string) => [...host.querySelectorAll("button")].find(node => node.textContent === label)!;
  const click = (label: string) => act(async () => { button(label).click(); });
  const render = (next = scope, document = target) => act(async () => {
    root.render(<PaigeDocumentWindowHost scope={next}><Card document={document} /></PaigeDocumentWindowHost>);
  });

  it("keeps the same saved render and Chat mounted through expand, dock and reopen", async () => {
    await render();
    const original = button("Open");
    await click("Open");
    expect(fake.eq.mock.calls).toEqual([["tenant_id", "tenant"], ["id", "document"]]);
    expect(host.textContent).toContain("Saved version 1");
    const preview = host.querySelector("article");
    await click("Expand");
    expect(host.querySelector("[data-paige-document-mode]")?.getAttribute("data-paige-document-mode")).toBe("full");
    expect(host.querySelector("article")).toBe(preview);
    expect(button("Open")).toBe(original);
    await click("Show beside Chat");
    expect(host.querySelector("article")).toBe(preview);
    await click("Close document");
    await click("Open");
    expect(fake.read).toHaveBeenCalledTimes(2);
    expect(host.textContent).toContain(saved.data.body);
  });

  it("opens full page on a narrow screen and checks access again on reopen", async () => {
    wide = false;
    await render();
    await click("Open");
    expect(button("Expand")).toBeUndefined();
    await click("Back to chat");
    fake.read.mockResolvedValue({ data: null, error: null });
    await click("Open");
    expect(host.querySelector("article")).toBeNull();
    expect(host.textContent).toContain("Check access and try again.");
  });

  it("refuses a changed body even when the saved revision number matches", async () => {
    await render();
    await click("Open");
    await click("Close document");
    fake.read.mockResolvedValue({ ...saved, data: { ...saved.data, body: "Changed draft." } });
    await click("Open");
    expect(host.querySelector("article")).toBeNull();
    expect(host.textContent).toContain("cannot confirm the earlier version");
  });

  it("ignores foreign document targets and discards a late read after the conversation changes", async () => {
    await render(scope, { ...target, tenantId: "other" });
    await click("Open");
    expect(fake.read).not.toHaveBeenCalled();
    let settle!: (value: typeof saved) => void;
    fake.read.mockImplementationOnce(() => new Promise(resolve => { settle = resolve; }));
    await render();
    await click("Open");
    const signal = fake.abort.mock.calls[0][0] as AbortSignal;
    await render({ ...scope, key: "another-chat" });
    expect(signal.aborted).toBe(true);
    await act(async () => settle(saved));
    expect(host.querySelector("article")).toBeNull();
  });
});
