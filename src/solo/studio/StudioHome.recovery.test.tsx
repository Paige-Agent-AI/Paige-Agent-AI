// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { StudioProjectContext } from "./studio-data";
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const h = vi.hoisted(() => ({ starts: [] as Array<{ requestId: string; brief: string; context: StudioProjectContext }>, lookups: [] as string[], ready: false }));
vi.mock("./studio-data", async original => {
  const real = await original<typeof import("./studio-data")>();
  return { ...real, listTemplates: async () => [], loadBrand: async () => ({ floor: {}, name: null, logoUrl: null }),
    readStudioBusinessSources: async () => ({ readStatus: "unavailable", context: null, publicBrand: undefined }),
    startStudioProject: async (input: { requestId: string; brief: string; context: StudioProjectContext }) => { h.starts.push(input); throw new real.ProjectStartUnknown("Check the same original start."); },
    lookupStudioProjectStart: async (_tenant: string, id: string) => { h.lookups.push(id); return h.ready ? { sessionId: "11111111-1111-4111-8111-111111111111", threadId: "22222222-2222-4222-8222-222222222222", created: false } : null; },
  };
});
const { StudioHome } = await import("./StudioHome");
let host: HTMLDivElement, root: Root;
const open = vi.fn(), pending = vi.fn();
beforeEach(() => { h.starts = []; h.lookups = []; h.ready = false; open.mockClear(); pending.mockClear(); host = document.createElement("div"); document.body.append(host); root = createRoot(host); });
afterEach(() => { act(() => root.unmount()); host.remove(); });
async function render(recoverStartId?: string) { await act(async () => root.render(<StudioHome sessions={[]} sessionsError={null} tenantId="test-tenant-one" tenantSlug="test-workspace" recoverStartId={recoverStartId} onStartPending={pending} onOpen={open} />)); }
function button(label: string) { return [...host.querySelectorAll<HTMLButtonElement>("button")].find(value => value.textContent?.trim() === label)!; }
async function brief(text: string) {
  const input = host.querySelector<HTMLTextAreaElement>("#vs-brief")!;
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(input, text); input.dispatchEvent(new Event("input", { bubbles: true })); });
}
it.each(["client", "prospect", "custom"] as const)("reconciles explicit %s requests before the original start instead of inheriting workspace context", async kind => {
  await render();
  const phrase = kind === "custom" ? "a different brand" : `my ${kind}`;
  await brief(`Build a page for ${phrase}.\nBusiness name: Northwind`);
  expect(button(kind === "custom" ? "Custom" : kind === "client" ? "Client" : "Prospect").getAttribute("aria-pressed")).toBe("true");
  await act(async () => button("Build it").click());
  expect(h.starts[0].context).toMatchObject({ target: { kind, reference: expect.stringMatching(/^[0-9a-f-]{36}$/i) }, values: { publicName: "Northwind" } });
});
it("keeps a manual target choice and shows review feedback instead of overriding it", async () => {
  await render(); await act(async () => button("Custom").click());
  await brief("Build a landing page for my business.");
  expect(button("Custom").getAttribute("aria-pressed")).toBe("true");
  expect(host.textContent).toContain("Review the selected brand");
  await act(async () => button("Build it").click());
  expect(h.starts[0].context.target.kind).toBe("custom");
});
it("keeps manual project edits when the request text later names another category", async () => {
  await render();
  const label = [...host.querySelectorAll("label")].find(value => value.textContent === "Business name")!;
  const input = document.getElementById(label.htmlFor) as HTMLInputElement;
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "Manually chosen"); input.dispatchEvent(new Event("input", { bubbles: true })); });
  await brief("Build a page for my client.");
  await act(async () => button("Build it").click());
  expect(h.starts[0].context).toMatchObject({ target: { kind: "workspace" }, values: { publicName: "Manually chosen" } });
});
it("freezes the original target/context through an unknown start even if the typed brief changes", async () => {
  await render(); await brief("Build for my client.\nBusiness name: Northwind");
  await act(async () => button("Build it").click());
  const original = h.starts[0];
  await brief("Build for my business.\nBusiness name: Another name");
  expect(button("Client").getAttribute("aria-pressed")).toBe("true");
  await act(async () => button("Check earlier start").click());
  expect(h.starts).toEqual([original]); expect(h.lookups).toEqual([original.requestId]);
});
it("recovers an unknown start after full remount by its same pointer, with no new create or seed", async () => {
  await render();
  const input = host.querySelector<HTMLTextAreaElement>("textarea")!;
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(input, "Build a landing page for the supplied offer"); input.dispatchEvent(new Event("input", { bubbles: true })); });
  await act(async () => button("Build it").click());
  expect(h.starts).toHaveLength(1);
  const requestId = h.starts[0].requestId;
  expect(pending).toHaveBeenCalledWith(requestId);
  act(() => root.unmount()); root = createRoot(host);
  await render(requestId);
  expect(button("Check earlier start").disabled).toBe(false);
  expect(host.querySelector<HTMLTextAreaElement>("textarea")?.value).toBe("");
  h.ready = true;
  await act(async () => button("Check earlier start").click());
  expect(h.lookups).toEqual([requestId]); expect(h.starts).toHaveLength(1);
  expect(open).toHaveBeenCalledWith("11111111-1111-4111-8111-111111111111", null);
  expect(pending).toHaveBeenLastCalledWith(null);
});
it("an unverified lookup remains check-only and never creates from mount or repeat checks", async () => {
  const requestId = "33333333-3333-4333-8333-333333333333";
  await render(requestId);
  expect(h.starts).toHaveLength(0); expect(h.lookups).toHaveLength(0);
  await act(async () => button("Check earlier start").click());
  await act(async () => button("Check earlier start").click());
  expect(h.lookups).toEqual([requestId, requestId]); expect(h.starts).toHaveLength(0); expect(open).not.toHaveBeenCalled();
});
