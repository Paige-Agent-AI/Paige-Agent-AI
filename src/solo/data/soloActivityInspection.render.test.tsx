// @vitest-environment jsdom
import React, { act, useLayoutEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useSoloActivityFeed } from "./useSoloActivityFeed";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const id = "11111111-1111-4111-8111-111111111111";
const other = "22222222-2222-4222-8222-222222222222";
const event = (key = id) => ({ id: key, title: "Original recorded event", occurred_at: "2026-11-01T12:00:00Z", actor_type: "owner_staff" });
const h = vi.hoisted(() => ({ exact: { data: [] as unknown, error: null as null | { code: string; message: string } },
  wait: null as null | Promise<void>, calls: [] as Array<{ p_limit: number; p_event_id?: string }> }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: async (name: string, args: { p_limit: number; p_event_id?: string }) => {
  if (name !== "get_solo_rail_activity") throw Error("unexpected reader");
  h.calls.push(args);
  if (args.p_event_id === undefined) return { data: [event()], error: null };
  const result = h.exact, waiting = h.wait;
  if (waiting) await waiting;
  return result;
} } }));
let container: HTMLDivElement, root: Root;
const frames: string[] = [];
function Probe({ selected, workspace = "test-tenant-a" }: { selected: string | null; workspace?: string }) {
  const feed = useSoloActivityFeed(workspace, selected);
  useLayoutEffect(() => { frames.push(container.textContent ?? ""); });
  return <><span data-state>{feed.inspection?.status}</span><span data-global>{feed.status}</span>
    {feed.inspection?.item && <span data-original>{feed.inspection.item.id}</span>}
    <button onClick={feed.refresh}>Refresh</button></>;
}
beforeEach(() => { container = document.createElement("div"); document.body.append(container); root = createRoot(container);
  h.exact = { data: [event()], error: null }; h.wait = null; h.calls = []; frames.length = 0; });
afterEach(() => { act(() => root.unmount()); container.remove(); });
async function render(selected: string | null, workspace?: string) { await act(async () => { root.render(<Probe selected={selected} workspace={workspace} />); }); }
const state = () => container.querySelector("[data-state]")?.textContent;

describe("same Rail exact-event inspection", () => {
  it("keeps incumbent consumers on their original one-argument read", async () => {
    await render(null); expect(state()).toBe("idle"); expect(h.calls).toEqual([{ p_limit: 25 }]);
  });
  it("reads the selected original identity through the same scoped family", async () => {
    await render(id); expect(state()).toBe("ready");
    expect(container.querySelector("[data-original]")?.textContent).toBe(id);
    expect(h.calls).toEqual([{ p_limit: 25 }, { p_limit: 1, p_event_id: id }]);
  });
  it("never substitutes the current sample for an absent original event", async () => {
    h.exact = { data: [], error: null }; await render(other);
    expect(state()).toBe("not_found"); expect(container.querySelector("[data-original]")).toBeNull();
    expect(container.querySelector("[data-global]")?.textContent).toBe("ready");
  });
  it.each([null, {}, [event(other)], [event(), event()]].map(data => ({ data })))("withholds malformed or mismatched exact responses (%j)", async ({ data }) => {
    h.exact = { data, error: null }; await render(id);
    expect(state()).toBe("unavailable"); expect(container.querySelector("[data-original]")).toBeNull();
  });
  it("withholds the original and sample when the same native authority refuses", async () => {
    h.exact = { data: null, error: { code: "42501", message: "RAIL_FORBIDDEN" } }; await render(id);
    expect(state()).toBe("forbidden"); expect(container.querySelector("[data-global]")?.textContent).toBe("forbidden");
    expect(container.querySelector("[data-original]")).toBeNull();
  });
  it("does not query an invalid locator", async () => {
    await render("not-an-event"); expect(state()).toBe("unavailable"); expect(h.calls).toEqual([{ p_limit: 25 }]);
  });
  it("discards an earlier identity response after selection changes", async () => {
    let release!: () => void; h.wait = new Promise<void>(resolve => { release = resolve; });
    await render(id); expect(state()).toBe("loading");
    h.wait = null; h.exact = { data: [event(other)], error: null }; await render(other);
    expect(container.querySelector("[data-original]")?.textContent).toBe(other);
    await act(async () => { release(); });
    expect(container.querySelector("[data-original]")?.textContent).toBe(other);
  });
  it("never paints previous-workspace inspection facts in a new workspace", async () => {
    await render(id); expect(state()).toBe("ready"); frames.length = 0;
    h.exact = { data: [], error: null }; await render(id, "test-tenant-b");
    expect(frames.every(frame => !frame.includes(id))).toBe(true); expect(state()).toBe("not_found");
  });
});
