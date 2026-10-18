import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import source from "../../__tests__/fixtures/exp04-client-status-source.json";

// E09 Slice 3: the engagement read now carries each item's share state and row version, plus a shared
// count (20271110030000). The parser is not exact-key, so they pass through; the share control only
// trusts an item that carries BOTH, well-formed. reload() is the confirm-after-write read (§70.1).
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const TENANT = (source as { tenant_id: string }).tenant_id, CLIENT = (source as { contact_id: string }).contact_id;
const rpc = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: (...a: unknown[]) => rpc(...a) } }));
vi.mock("@/hooks/useTenantContext", () => ({ useTenantContext: () => ({ activeTenantId: TENANT, accountContextLoading: false }) }));
import { readClientEngagementStatus, shareableWorkItem, useClientEngagementStatus } from "./useClientEngagementStatus";

const V1 = "2026-10-14T12:00:00.123456+00:00";
function withShare(patch: (items: Array<Record<string, unknown>>) => void = items => items.forEach(i => Object.assign(i, { shared: false, updated_at: V1 }))) {
  const s = structuredClone(source) as Record<string, unknown> & { work: Record<string, unknown> & { items: Array<Record<string, unknown>> } };
  patch(s.work.items); s.work.shared = s.work.items.filter(i => i.shared === true).length;
  return { data: s, error: null };
}

describe("engagement read · share fields", () => {
  beforeEach(() => rpc.mockReset());

  it("passes each item's shared state and version through, and accepts the shared count", async () => {
    rpc.mockResolvedValue(withShare(items => { items.forEach(i => Object.assign(i, { shared: false, updated_at: V1 })); items[1].shared = true; }));
    const s = await readClientEngagementStatus(TENANT, CLIENT);
    expect(s.work.items.map(i => [i.shared, i.updated_at])).toEqual([[false, V1], [true, V1], [false, V1]]);
    expect(s.work.items.every(shareableWorkItem)).toBe(true);
  });

  it("an older reader without the fields still reads, but offers nothing to share", async () => {
    rpc.mockResolvedValue({ data: structuredClone(source), error: null });
    const s = await readClientEngagementStatus(TENANT, CLIENT);
    expect(s.work.total).toBe(3);
    expect(s.work.items.some(shareableWorkItem)).toBe(false);
  });

  it("a malformed version, a non-boolean share, cancelled work or a reminder is never shareable", () => {
    const base = { id: "x", plan_id: null, item_type: "task" as const, title: "T", status: "open", due_at: null, completed_at: null, assigned: false };
    expect(shareableWorkItem({ ...base, shared: false, updated_at: V1 })).toBe(true);
    expect(shareableWorkItem({ ...base, shared: false, updated_at: "yesterday" })).toBe(false);
    expect(shareableWorkItem({ ...base, shared: "no" as unknown as boolean, updated_at: V1 })).toBe(false);
    expect(shareableWorkItem({ ...base, status: "cancelled", shared: true, updated_at: V1 })).toBe(false);
    expect(shareableWorkItem({ ...base, item_type: "reminder" as unknown as "task", shared: false, updated_at: V1 })).toBe(false);
  });
});

describe("engagement read · one read per record open", () => {
  beforeEach(() => rpc.mockReset());

  it("two sections reading the same client in one pass share ONE request", async () => {
    rpc.mockResolvedValue(withShare());
    const [a, b] = await Promise.all([readClientEngagementStatus(TENANT, CLIENT), readClientEngagementStatus(TENANT, CLIENT)]);
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(a).toBe(b);
  });

  it("a fresh read never joins one that started before it, and nothing is kept after the pass", async () => {
    rpc.mockResolvedValue(withShare());
    const first = readClientEngagementStatus(TENANT, CLIENT);
    await readClientEngagementStatus(TENANT, CLIENT, { fresh: true });
    expect(rpc).toHaveBeenCalledTimes(2);
    await first;
    await readClientEngagementStatus(TENANT, CLIENT);
    expect(rpc).toHaveBeenCalledTimes(3);
  });

  it("a read that never settles cannot capture a later one", async () => {
    rpc.mockImplementationOnce(() => new Promise(() => {})).mockResolvedValue(withShare());
    void readClientEngagementStatus(TENANT, CLIENT);
    await Promise.resolve();
    await expect(readClientEngagementStatus(TENANT, CLIENT)).resolves.toMatchObject({ client: { id: CLIENT } });
    expect(rpc).toHaveBeenCalledTimes(2);
  });
});

describe("useClientEngagementStatus · reload", () => {
  let host: HTMLDivElement, root: Root;
  let latest: ReturnType<typeof useClientEngagementStatus> | null = null;
  const phases: string[] = [];
  function Probe() { latest = useClientEngagementStatus(CLIENT); phases.push(latest.phase); return null; }
  beforeEach(() => { rpc.mockReset(); phases.length = 0; host = document.createElement("div"); document.body.append(host); root = createRoot(host); });
  afterEach(() => { act(() => root.unmount()); host.remove(); });

  it("re-reads without a loading flash and resolves with what the server says now", async () => {
    rpc.mockResolvedValueOnce(withShare());
    await act(async () => root.render(<Probe />)); await act(async () => { await Promise.resolve(); });
    expect(latest!.phase).toBe("ready");
    let answer!: (v: unknown) => void;
    rpc.mockImplementationOnce(() => new Promise(resolve => { answer = resolve; }));
    phases.length = 0;
    let pending!: ReturnType<NonNullable<typeof latest>["reload"]>;
    await act(async () => { pending = latest!.reload(); await Promise.resolve(); });
    // While the fresh read is in flight, the last answer stays on screen.
    expect(latest!.phase).toBe("ready");
    let fresh: Awaited<typeof pending> | undefined;
    await act(async () => {
      answer(withShare(items => { items.forEach(i => Object.assign(i, { shared: false, updated_at: V1 })); items[0].shared = true; }));
      fresh = await pending;
    });
    expect(fresh!.work.items[0].shared).toBe(true);
    expect(latest!.phase === "ready" && latest!.status.work.items[0].shared).toBe(true);
    expect(phases).not.toContain("loading");
    expect(rpc).toHaveBeenCalledTimes(2);
  });

  it("a failed reload rejects and leaves the last answer on screen", async () => {
    rpc.mockResolvedValueOnce(withShare());
    await act(async () => root.render(<Probe />)); await act(async () => { await Promise.resolve(); });
    rpc.mockResolvedValueOnce({ data: null, error: { code: "57014" } });
    let failed = false;
    await act(async () => { await latest!.reload().catch(() => { failed = true; }); });
    expect(failed).toBe(true);
    expect(latest!.phase).toBe("ready");
  });
});
