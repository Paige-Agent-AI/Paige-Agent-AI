import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { KnowledgeDocument } from "@/lib/knowledge-service";
import { OperationsPlaybooks } from "./OperationsPlaybooks";

const fixture = vi.hoisted(() => ({ docs: [] as KnowledgeDocument[], detail: [] as KnowledgeDocument[], loading: false, error: null as string | null,
  detailLoading: false, detailError: null as string | null, current: true, rpc: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: fixture.rpc } }));
vi.mock("@/hooks/useKnowledgeDocuments", () => ({ useKnowledgeDocuments: (_tenant: string, id?: string) => ({
  docs: id ? fixture.detail : fixture.docs, loading: id ? fixture.detailLoading : fixture.loading,
  error: id ? fixture.detailError : fixture.error, hasMore: false, reload: vi.fn(), loadMore: vi.fn(), isCurrent: () => fixture.current,
}) }));
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root, container: HTMLDivElement, shell: HTMLDivElement;
const doc = { id: "test-procedure-a", tenant_id: "test-tenant-a", title: "Client handoff", summary: "Confirm the next owner.",
  category: "SOP", tags: [], revision: 2, source: "manual", source_url: null, chunk_count: 0, created_at: "2026-10-22T12:00:00Z",
  updated_at: "2026-10-22T12:00:00Z", share_to_network: false, network_review_status: "none", content: "Source body, never copied to the handoff." } as KnowledgeDocument;
const reply = (documents: KnowledgeDocument[]) => ({ data: { tenant_id: doc.tenant_id, documents }, error: null });
beforeEach(() => {
  Object.assign(fixture, { docs: [doc], detail: [{ ...doc, revision: 3 }], loading: false, error: null, detailLoading: false, detailError: null, current: true });
  fixture.rpc.mockReset().mockResolvedValue(reply([{ ...doc, revision: 3 }]));
  shell = document.createElement("div"); shell.dataset.tenantShell = ""; document.body.append(shell);
  container = document.createElement("div"); shell.append(container); root = createRoot(container);
});
afterEach(() => { act(() => root.unmount()); shell.remove(); vi.useRealTimers(); });
function button(text: string) { return Array.from(document.querySelectorAll("button")).find(b => b.textContent?.trim() === text); }
async function render(onPrepare = vi.fn()) { await act(async () => root.render(<OperationsPlaybooks tenantId="test-tenant-a" onPrepare={onPrepare} />)); return onPrepare; }
async function inspect() { await act(async () => container.querySelector<HTMLButtonElement>(".ops-procedure-index>button")!.click()); }

it("prepares only the re-read source identity and revision, closes inspection and does not copy source instructions", async () => {
  const prepare = await render(); await inspect();
  await act(async () => button("Prepare workflow draft")!.click());
  expect(fixture.rpc).toHaveBeenCalledExactlyOnceWith("read_tenant_knowledge", { p_expected_tenant: doc.tenant_id, p_doc_id: doc.id, p_limit: 1, p_offset: 0 });
  expect(prepare).toHaveBeenCalledExactlyOnceWith({ id: doc.id, tenant_id: doc.tenant_id, title: doc.title, revision: 3 });
  expect(document.querySelector('[role="dialog"]')).toBeNull();
});
it.each(["loading", "error", "removed", "foreign", "retagged"])("does not prepare from a %s detail source", async state => {
  if (state === "loading") fixture.detailLoading = true;
  if (state === "error") fixture.detailError = "Source refused";
  if (state === "removed") fixture.detail = [];
  if (state === "foreign") fixture.detail = [{ ...doc, tenant_id: "test-tenant-b" }];
  if (state === "retagged") fixture.detail = [{ ...doc, category: "other" }];
  const prepare = await render(); await inspect();
  expect(button("Prepare workflow draft")).toBeUndefined(); expect(prepare).not.toHaveBeenCalled();
});
it("refuses a scope retired between display and activation without reading", async () => {
  const prepare = await render(); await inspect(); fixture.current = false;
  await act(async () => button("Prepare workflow draft")!.click());
  expect(prepare).not.toHaveBeenCalled(); expect(fixture.rpc).not.toHaveBeenCalled();
});
it.each(["changed", "removed", "foreign", "retagged", "refused"])("re-reads and refuses a %s source even though the displayed hook scope is current", async state => {
  const prepare = await render(); await inspect();
  fixture.rpc.mockResolvedValue(state === "refused" ? { data: null, error: { code: "42501", message: "Refused" } }
    : reply(state === "removed" ? [] : [{ ...doc, revision: state === "changed" ? 4 : 3,
      tenant_id: state === "foreign" ? "test-tenant-b" : doc.tenant_id, category: state === "retagged" ? "other" : "SOP" }]));
  await act(async () => button("Prepare workflow draft")!.click());
  expect(fixture.rpc).toHaveBeenCalledOnce(); expect(prepare).not.toHaveBeenCalled();
  expect(document.querySelector('[role="dialog"]')).toBeTruthy();
  expect(document.querySelector('[role="alert"]')?.textContent).toContain("Reload source");
  expect(button("Prepare workflow draft")?.disabled).toBe(true);
  expect(document.activeElement).toBe(button("Reload source"));
});
it("allows one checking read and withholds a late reply after the scope retires", async () => {
  let finish!: (value: ReturnType<typeof reply>) => void;
  fixture.rpc.mockReturnValue(new Promise(resolve => { finish = resolve; }));
  const prepare = await render(); await inspect();
  const start = button("Prepare workflow draft")!;
  await act(async () => { start.click(); start.click(); });
  expect(fixture.rpc).toHaveBeenCalledOnce(); expect(button("Checking source…")?.disabled).toBe(true);
  fixture.current = false;
  await act(async () => finish(reply([{ ...doc, revision: 3 }])));
  expect(prepare).not.toHaveBeenCalled();
});
it("bounds a stalled recheck and ignores its later response", async () => {
  vi.useFakeTimers(); let finish!: (value: ReturnType<typeof reply>) => void;
  fixture.rpc.mockReturnValue(new Promise(resolve => { finish = resolve; }));
  const prepare = await render(); await inspect();
  await act(async () => button("Prepare workflow draft")!.click());
  await act(async () => { await vi.advanceTimersByTimeAsync(8_000); });
  expect(document.querySelector('[role="alert"]')?.textContent).toContain("Reload source");
  await act(async () => finish(reply([{ ...doc, revision: 3 }])));
  expect(prepare).not.toHaveBeenCalled();
});
it("requires a reload and a fresh review after the source revision changes", async () => {
  const prepare = await render(); await inspect();
  fixture.rpc.mockResolvedValue(reply([{ ...doc, revision: 4 }]));
  await act(async () => button("Prepare workflow draft")!.click());
  expect(prepare).not.toHaveBeenCalled();
  fixture.detail = [{ ...doc, revision: 4 }];
  await act(async () => button("Reload source")!.click());
  expect(document.querySelector('[role="dialog"]')?.textContent).toContain("Revision 4");
  await act(async () => button("Prepare workflow draft")!.click());
  expect(prepare).toHaveBeenCalledExactlyOnceWith({ id: doc.id, tenant_id: doc.tenant_id, title: doc.title, revision: 4 });
});
it("withholds preparation without a conversation callback", async () => {
  await act(async () => root.render(<OperationsPlaybooks tenantId="test-tenant-a" />)); await inspect();
  expect(button("Prepare workflow draft")?.disabled).toBe(true);
});
it.each([false, true])("keeps a usable keyboard destination after the source handoff (composer disabled:%s)", async disabled => {
  const composer = document.createElement("textarea"); composer.setAttribute("aria-label", "Message PAIGE"); composer.disabled = disabled;
  vi.spyOn(composer, "getClientRects").mockReturnValue([new DOMRect(0, 0, 300, 80)] as unknown as DOMRectList);
  const panel = document.createElement("aside"); panel.id = "tenant-paige-workspace"; panel.append(composer); shell.append(panel);
  await render(); const sourceButton = container.querySelector<HTMLButtonElement>(".ops-procedure-index>button")!;
  sourceButton.focus(); await inspect();
  await act(async () => button("Prepare workflow draft")!.click());
  await vi.waitFor(() => expect(document.activeElement).toBe(disabled ? sourceButton : composer));
});
it("filters a foreign source from the library", async () => {
  fixture.docs = [{ ...doc, tenant_id: "test-tenant-b" }]; await render();
  expect(container.querySelector(".ops-procedure-index")).toBeNull();
});
it("offers prospective routines without pretending they are saved or running", async () => {
  fixture.docs = []; const prepare = await render();
  const starter = container.querySelector<HTMLButtonElement>(".ops-procedure-routines>button")!;
  await act(async () => starter.click());
  expect(prepare).toHaveBeenCalledExactlyOnceWith(null, "Client handoff");
  expect(container.textContent).toContain("Nothing is saved, enabled or run");
});
it.each(["Client handoff", "Weekly review", "Quality check"])("continues %s preparation in the editable composer without sending", async name => {
  fixture.docs = [];
  const panel = document.createElement("aside"); panel.id = "tenant-paige-workspace";
  const composer = document.createElement("textarea"); composer.setAttribute("aria-label", "Message PAIGE"); panel.append(composer); shell.append(panel);
  vi.spyOn(composer, "getClientRects").mockReturnValue([new DOMRect(0, 0, 300, 80)] as unknown as DOMRectList);
  const prepare = await render(vi.fn(() => { composer.value = "Existing editable draft\nPrepared question"; }));
  const starter = Array.from(container.querySelectorAll<HTMLButtonElement>(".ops-procedure-routines>button")).find(b => b.textContent?.includes(name))!;
  starter.focus(); await act(async () => starter.click());
  await vi.waitFor(() => expect(document.activeElement).toBe(composer));
  expect(prepare).toHaveBeenCalledExactlyOnceWith(null, name);
  expect(composer.value).toBe("Existing editable draft\nPrepared question"); expect(fixture.rpc).not.toHaveBeenCalled();
});
it.each(["disabled", "hidden", "foreign", "retired", "detached"])("does not transfer routine focus to a %s destination", async state => {
  vi.useFakeTimers(); fixture.docs = [];
  const panel = document.createElement("aside"); panel.id = "tenant-paige-workspace";
  const composer = document.createElement("textarea"); composer.setAttribute("aria-label", "Message PAIGE"); panel.append(composer);
  if (state === "foreign") document.body.append(panel); else shell.append(panel);
  if (state === "disabled") composer.disabled = true;
  if (state === "hidden") panel.hidden = true;
  vi.spyOn(composer, "getClientRects").mockReturnValue([new DOMRect(0, 0, 300, 80)] as unknown as DOMRectList);
  await render(vi.fn(() => { if (state === "retired") fixture.current = false; if (state === "detached") shell.remove(); }));
  const starter = container.querySelector<HTMLButtonElement>(".ops-procedure-routines>button")!;
  starter.focus(); await act(async () => { starter.click(); await vi.advanceTimersByTimeAsync(50); });
  expect(document.activeElement).not.toBe(composer);
  if (state !== "detached") expect(document.activeElement).toBe(starter);
  expect(fixture.rpc).not.toHaveBeenCalled(); panel.remove();
});
it.each(["loading", "refused"])("does not present routine preparation as a successful %s source read", async state => {
  fixture.docs = []; fixture.loading = state === "loading"; fixture.error = state === "refused" ? "Access refused" : null;
  await render(); expect(container.querySelector(".ops-procedure-routines")).toBeNull();
});
it("retains original search and clear behavior", async () => {
  await render(); const input = container.querySelector("input")!;
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "unmatched"); input.dispatchEvent(new Event("input", { bubbles: true })); });
  expect(container.textContent).toContain("No matching procedure");
  await act(async () => button("Clear search")!.click());
  expect(container.querySelector(".ops-procedure-index")).toBeTruthy();
});
