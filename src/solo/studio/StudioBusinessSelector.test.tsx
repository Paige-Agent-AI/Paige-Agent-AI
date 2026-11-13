import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { StudioBusinessSelector } from "./StudioBusinessSelector";
import { applyStudioBusinessSelection } from "./studio-business-selection";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const ports = vi.hoisted(() => ({ read: vi.fn(), account: { accountContextStatus: "ready", accountContextLoading: false, activeUserId: "actor-one", activeTenantId: "tenant-one", activeTenant: { id: "tenant-one" } } }));
vi.mock("./studio-data", () => ({ loadStudioBusinessTargets: ports.read }));
vi.mock("@/hooks/useTenantContext", () => ({ useTenantContext: () => ports.account }));
const business = { id: "11111111-1111-4111-8111-111111111111", entity_name: "Cedar Consulting", updated_at: "2026-11-13T10:20:30.123456+00:00" };
const target = { kind: "client" as const, reference: "manual-project" };
const deferred = <T,>() => { let resolve!: (value: T) => void; const promise = new Promise<T>(yes => { resolve = yes; }); return { promise, resolve }; };
let host: HTMLDivElement, root: Root;
const onSelect = vi.fn();
const button = (name: string) => Array.from(host.querySelectorAll("button")).find(node => node.textContent === name)!;
async function show(next = target) { await act(async () => root.render(<StudioBusinessSelector tenantId="tenant-one" target={next} onSelect={onSelect} />)); }
beforeEach(() => {
  ports.read.mockReset(); onSelect.mockClear();
  Object.assign(ports.account, { accountContextStatus: "ready", accountContextLoading: false, activeUserId: "actor-one", activeTenantId: "tenant-one", activeTenant: { id: "tenant-one" } });
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); vi.useRealTimers(); });

describe("original minimal Studio business selection", () => {
  it("performs no read on render or typing, then searches only on the explicit control", async () => {
    ports.read.mockResolvedValue([business]); await show();
    expect(ports.read).not.toHaveBeenCalled();
    const search = host.querySelector('input[type="search"]')!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(search, "Cedar");
      search.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(ports.read).not.toHaveBeenCalled();
    await act(async () => button("Search businesses").click());
    expect(ports.read).toHaveBeenCalledExactlyOnceWith("tenant-one", "Cedar", expect.any(AbortSignal));
    await act(async () => { const select = host.querySelector("select")!; select.value = business.id; select.dispatchEvent(new Event("change", { bubbles: true })); });
    expect(onSelect).toHaveBeenCalledExactlyOnceWith(business);
  });
  it("does not read or mount a selector for workspace or custom project context", async () => {
    await act(async () => root.render(<StudioBusinessSelector tenantId="tenant-one" target={{ kind: "workspace" }} onSelect={onSelect} />));
    expect(host.querySelector("input")).toBeNull();
    await act(async () => root.render(<StudioBusinessSelector tenantId="tenant-one" target={{ kind: "custom", reference: "custom" }} onSelect={onSelect} />));
    expect(host.querySelector("input")).toBeNull(); expect(ports.read).not.toHaveBeenCalled();
  });
  it("does not overlap reads and aborts the original read on teardown", async () => {
    const pending = deferred<typeof business[]>(); ports.read.mockReturnValue(pending.promise); await show();
    await act(async () => button("Search businesses").click());
    await act(async () => button("Searching…").click());
    expect(ports.read).toHaveBeenCalledTimes(1);
    const signal = ports.read.mock.calls[0][2] as AbortSignal;
    await act(async () => root.render(null));
    await act(async () => pending.resolve([business])); expect(signal.aborted).toBe(true);
  });
  it.each(["tenant", "actor", "target", "incarnation"])("discards a late read after %s changes", async kind => {
    const pending = deferred<typeof business[]>(); ports.read.mockReturnValue(pending.promise); await show();
    await act(async () => button("Search businesses").click());
    if (kind === "actor" || kind === "incarnation") ports.account.activeUserId = "actor-two";
    else if (kind === "tenant") ports.account.activeTenantId = "tenant-two";
    const nextTarget = kind === "target" ? { kind: "client" as const, reference: "different-project" } : target;
    await show(nextTarget);
    if (kind === "incarnation") { ports.account.activeUserId = "actor-one"; await show(); }
    await act(async () => pending.resolve([business]));
    expect(host.querySelector("select")).toBeNull(); expect(host.textContent).not.toContain(business.entity_name);
  });
  it("times out one read without polling, selecting stale results or repeating it", async () => {
    vi.useFakeTimers(); const pending = deferred<typeof business[]>(); ports.read.mockReturnValue(pending.promise); await show();
    await act(async () => button("Search businesses").click());
    await act(async () => vi.advanceTimersByTimeAsync(10_001));
    expect(host.querySelector('[role="status"]')?.textContent).toContain("could not be read");
    await act(async () => pending.resolve([business]));
    expect(ports.read).toHaveBeenCalledTimes(1); expect(host.querySelector("select")).toBeNull(); expect(vi.getTimerCount()).toBe(0);
  });
  it("refuses an unavailable or foreign account before search", async () => {
    ports.account.activeTenantId = "foreign"; await show();
    expect(button("Search businesses").disabled).toBe(true); expect(ports.read).not.toHaveBeenCalled();
  });
});

describe("business identity and authored context stay separate", () => {
  it("retains authored blanks and project choices while capturing exact expected identity", () => {
    const context = { target, values: { publicName: "", offers: "This project only" }, template_id: "nexus-editorial-landing-v1" as const };
    const selected = applyStudioBusinessSelection(context, business, "manual-new");
    expect(selected).toEqual({ ...context, target: { kind: "client", reference: business.id, label: business.entity_name }, business_source: { id: business.id, updated_at: business.updated_at } });
    expect(applyStudioBusinessSelection(selected, null, "manual-new")).toEqual({ ...context, target: { kind: "client", reference: "manual-new" } });
  });
  it("does not bind workspace/custom or truncate a long business identity", () => {
    const workspace = { target: { kind: "workspace" as const }, values: {} };
    expect(applyStudioBusinessSelection(workspace, business, "unused")).toBe(workspace);
    const longName = { ...business, entity_name: "C".repeat(201) };
    expect(applyStudioBusinessSelection({ target, values: {} }, longName, "unused")).toEqual({ target: { kind: "client", reference: business.id }, values: { publicName: longName.entity_name }, business_source: { id: business.id, updated_at: business.updated_at } });
  });
});
