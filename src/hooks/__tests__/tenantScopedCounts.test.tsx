import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

// Owner live drive 2026-09-28: a super_admin acting as one workspace is admitted to every
// workspace's knowledge documents and open actions by RLS (is_platform_owner()). Hooks that relied
// on RLS alone therefore counted and listed the whole fleet as if it were the entered workspace.
// A member of several workspaces had the same problem through is_tenant_member(). The reads must
// bind to the active workspace whenever one is active.

const h = vi.hoisted(() => ({
  activeTenantId: null as string | null,
  filters: [] as Array<{ table: string; column: string; value: unknown }>,
}));

vi.mock("@/hooks/useTenantContext", () => ({
  useOptionalTenantContext: () => (h.activeTenantId === undefined ? null : { activeTenantId: h.activeTenantId }),
}));

vi.mock("@/integrations/supabase/client", () => {
  const builder = (table: string) => {
    const result = { data: [], error: null };
    const chain: Record<string, unknown> = {};
    for (const method of ["select", "order", "in", "limit"]) chain[method] = () => chain;
    chain.eq = (column: string, value: unknown) => {
      h.filters.push({ table, column, value });
      return chain;
    };
    chain.then = (resolve: (value: typeof result) => unknown) => Promise.resolve(result).then(resolve);
    return chain;
  };
  return { supabase: { from: (table: string) => builder(table) } };
});

import { useSoloKnowledge } from "@/solo/data/useSoloKnowledge";
import { usePaigeDeptStatus } from "../usePaigeDeptStatus";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function KnowledgeProbe() {
  useSoloKnowledge();
  return null;
}
function DeptProbe() {
  usePaigeDeptStatus();
  return null;
}

async function mount(node: JSX.Element) {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  await act(async () => { root.render(node); });
  await act(async () => { await Promise.resolve(); });
  return root;
}

const tenantFilters = (table: string) =>
  h.filters.filter((f) => f.table === table && f.column === "tenant_id").map((f) => f.value);

afterEach(() => {
  h.filters.length = 0;
  h.activeTenantId = null;
});

describe("reads that RLS alone would widen", () => {
  it("binds knowledge documents to the active workspace", async () => {
    h.activeTenantId = "tenant-a";
    const root = await mount(<KnowledgeProbe />);
    expect(tenantFilters("tenant_knowledge_docs")).toEqual(["tenant-a"]);
    root.unmount();
  });

  it("binds open actions behind the department counts to the active workspace", async () => {
    h.activeTenantId = "tenant-a";
    const root = await mount(<DeptProbe />);
    expect(tenantFilters("paige_actions")).toEqual(["tenant-a"]);
    root.unmount();
  });

  it("adds no workspace filter when no workspace is active", async () => {
    h.activeTenantId = null;
    const a = await mount(<KnowledgeProbe />);
    const b = await mount(<DeptProbe />);
    expect(tenantFilters("tenant_knowledge_docs")).toEqual([]);
    expect(tenantFilters("paige_actions")).toEqual([]);
    a.unmount();
    b.unmount();
  });
});
