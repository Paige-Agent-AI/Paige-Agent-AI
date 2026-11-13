// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const h = vi.hoisted(() => ({ starts: [] as Array<{ requestId: string; brief: string }>, lookups: [] as string[], ready: false }));
vi.mock("./studio-data", async original => {
  const real = await original<typeof import("./studio-data")>();
  return { ...real, listTemplates: async () => [], loadBrand: async () => ({ floor: {}, name: null, logoUrl: null }),
    readStudioBusinessSources: async () => ({ readStatus: "unavailable", context: null, publicBrand: undefined }),
    startStudioProject: async (input: { requestId: string; brief: string }) => { h.starts.push(input); throw new real.ProjectStartUnknown("Check the same original start."); },
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
