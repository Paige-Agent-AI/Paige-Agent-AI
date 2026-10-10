import React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type RpcResult = { data: { plans: unknown[]; loose_items: unknown[] }; error: null };
type Deferred = { promise: Promise<RpcResult>; resolve: (value: RpcResult) => void };

const deferred = (): Deferred => {
  let resolve!: (value: RpcResult) => void;
  const promise = new Promise<RpcResult>((done) => { resolve = done; });
  return { promise, resolve };
};

const harness = vi.hoisted(() => ({ calls: [] as Array<{ promise: Promise<unknown>; resolve: (value: unknown) => void }>, requests: [] as Array<{ name: string; parameters: Record<string, unknown> }> }));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: { getUser: () => Promise.resolve({ data: { user: { id: "qa-user" } } }) },
    rpc: (name: string, parameters: Record<string, unknown>) => {
      harness.requests.push({ name, parameters });
      const call = harness.calls.shift();
      if (!call) throw new Error("No plan_list response queued");
      return call.promise;
    },
  },
}));

import { usePlanList } from "./usePlanList";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function item(id: string, tenantId: string) {
  return {
    id,
    tenant_id: tenantId,
    plan_id: null,
    item_type: "task",
    assigned_to_user_id: "qa-user",
    contact_id: null,
    title: id,
    summary: null,
    status: "open",
    priority: "normal",
    due_at: "2026-08-26T12:00:00Z",
    remind_at: null,
    remind_target: null,
    reminded_at: null,
    created_by: "qa-user",
    linked_action_id: null,
  };
}

function Probe({ tenantId, guarded = false, actorId = "qa-user" }: { tenantId: string | null; guarded?: boolean; actorId?: string }) {
  const result = usePlanList({ tenantScopeKey: tenantId, enabled: tenantId !== null,
    ...(guarded ? { operationsActorId: actorId, operationsTenantId: tenantId } : {}) });
  return <output data-loading={String(result.loading)} data-forbidden={String(result.forbidden)}>{result.allItems.map((entry) => entry.id).join(",")}</output>;
}

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  harness.calls = [];
  harness.requests = [];
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe("usePlanList tenant epoch", () => {
  it("clears tenant A immediately and rejects its late response after tenant B resolves", async () => {
    const a = deferred();
    const b = deferred();
    harness.calls = [a, b];

    await act(async () => {
      root.render(<Probe tenantId="tenant-a" guarded />);
      await Promise.resolve();
    });

    await act(async () => {
      root.render(<Probe tenantId="tenant-b" guarded />);
      await Promise.resolve();
    });
    expect(container.textContent).toBe("");

    await act(async () => {
      b.resolve({ data: { plans: [], loose_items: [item("item-b", "tenant-b")] }, error: null });
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(container.textContent).toBe("item-b");

    await act(async () => {
      a.resolve({ data: { plans: [], loose_items: [item("item-a", "tenant-a")] }, error: null });
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(container.textContent).toBe("item-b");
    expect(container.textContent).not.toContain("item-a");
    expect(harness.requests.map(request => request.name)).toEqual(["plan_list_operations_scoped", "plan_list_operations_scoped"]);
    expect(harness.requests[1].parameters).toMatchObject({ p_expected_actor_id: "qa-user", p_expected_tenant_id: "tenant-b" });
  });

  it("clears accepted items when tenant scope becomes unavailable", async () => {
    const a = deferred();
    harness.calls = [a];
    await act(async () => {
      root.render(<Probe tenantId="tenant-a" />);
      await Promise.resolve();
    });
    await act(async () => {
      a.resolve({ data: { plans: [], loose_items: [item("item-a", "tenant-a")] }, error: null });
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(container.textContent).toBe("item-a");

    await act(async () => {
      root.render(<Probe tenantId={null} />);
      await Promise.resolve();
    });
    expect(container.textContent).toBe("");
    expect(harness.requests[0].name).toBe("plan_list");
  });
  it("refuses a changed actor before requesting Operations records", async () => {
    await act(async () => root.render(<Probe tenantId="tenant-a" guarded actorId="different-user" />));
    expect(harness.requests).toEqual([]);
    expect(container.querySelector("output")?.getAttribute("data-forbidden")).toBe("true");
    expect(container.textContent).toBe("");
  });
  it("clears Operations work and reports a server authority refusal", async () => {
    harness.calls = [{ promise: Promise.resolve({ data: null, error: { message: "PLAN_FORBIDDEN: scope changed" } }), resolve: vi.fn() }];
    await act(async () => root.render(<Probe tenantId="tenant-a" guarded />));
    expect(container.textContent).toBe("");
    expect(container.querySelector("output")?.getAttribute("data-forbidden")).toBe("true");
  });
});
