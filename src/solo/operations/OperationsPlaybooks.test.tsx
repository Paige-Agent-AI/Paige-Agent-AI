import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { KnowledgeDocument } from "@/lib/knowledge-service";
import { OperationsPlaybooks } from "./OperationsPlaybooks";

const fixture = vi.hoisted(() => ({ docs: [] as KnowledgeDocument[], detail: [] as KnowledgeDocument[], loading: false, error: null as string | null,
  detailLoading: false, detailError: null as string | null, current: true }));
vi.mock("@/hooks/useKnowledgeDocuments", () => ({ useKnowledgeDocuments: (_tenant: string, id?: string) => ({
  docs: id ? fixture.detail : fixture.docs, loading: id ? fixture.detailLoading : fixture.loading,
  error: id ? fixture.detailError : fixture.error, hasMore: false, reload: vi.fn(), loadMore: vi.fn(), isCurrent: () => fixture.current,
}) }));
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root, container: HTMLDivElement;
const doc = { id: "test-procedure-a", tenant_id: "test-tenant-a", title: "Client handoff", summary: "Confirm the next owner.",
  category: "SOP", tags: [], revision: 2, source: "manual", content: "Source body, never copied to the handoff." } as KnowledgeDocument;
beforeEach(() => {
  Object.assign(fixture, { docs: [doc], detail: [{ ...doc, revision: 3 }], loading: false, error: null, detailLoading: false, detailError: null, current: true });
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
});
afterEach(() => { act(() => root.unmount()); container.remove(); });
function button(text: string) { return Array.from(document.querySelectorAll("button")).find(b => b.textContent?.trim() === text); }
async function render(onPrepare = vi.fn()) { await act(async () => root.render(<OperationsPlaybooks tenantId="test-tenant-a" onPrepare={onPrepare} />)); return onPrepare; }
async function inspect() { await act(async () => container.querySelector<HTMLButtonElement>(".ops-procedure-index>button")!.click()); }

it("prepares only the re-read source identity and revision, closes inspection and does not copy source instructions", async () => {
  const prepare = await render(); await inspect();
  await act(async () => button("Prepare workflow draft")!.click());
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
it("refuses a source retired between display and activation", async () => {
  const prepare = await render(); await inspect(); fixture.current = false;
  await act(async () => button("Prepare workflow draft")!.click());
  expect(prepare).not.toHaveBeenCalled();
});
it("withholds preparation without a conversation callback", async () => {
  await act(async () => root.render(<OperationsPlaybooks tenantId="test-tenant-a" />)); await inspect();
  expect(button("Prepare workflow draft")?.disabled).toBe(true);
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
