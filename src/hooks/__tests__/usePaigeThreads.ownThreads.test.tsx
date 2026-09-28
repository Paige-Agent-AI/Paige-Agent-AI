import { act } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";

// Owner live drive 2026-09-28 and ruling: a member's private conversation must never open unbidden
// or be presented as the viewer's own. The server no longer returns other people's private threads
// to anyone (member_threads_private_by_default); the list asks only for the viewer's own as well,
// so what the panel shows never depends on a policy alone.

const h = vi.hoisted(() => ({ filters: [] as Array<{ column: string; value: unknown }> }));

vi.mock("@/integrations/supabase/client", () => {
  const chain: Record<string, unknown> = {};
  for (const method of ["select", "is", "order"]) chain[method] = () => chain;
  chain.eq = (column: string, value: unknown) => {
    h.filters.push({ column, value });
    return chain;
  };
  chain.then = (resolve: (value: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(resolve);
  return { supabase: { from: () => chain, rpc: () => Promise.resolve({ data: null, error: null }) } };
});

import { usePaigeThreads } from "../usePaigeThreads";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function Probe({ platform }: { platform?: boolean }) {
  usePaigeThreads({ callerUserId: "viewer", tenantId: platform ? null : "tenant-a", platform });
  return null;
}

async function mount(platform?: boolean) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  await act(async () => {
    root.render(<QueryClientProvider client={client}><Probe platform={platform} /></QueryClientProvider>);
  });
  await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
  return root;
}

afterEach(() => { h.filters.length = 0; });

describe("the PAIGE thread list", () => {
  it("asks only for the viewer's own threads in a workspace", async () => {
    const root = await mount(false);
    expect(h.filters).toContainEqual({ column: "caller_user_id", value: "viewer" });
    root.unmount();
  });

  it("asks only for the viewer's own threads at platform scope", async () => {
    const root = await mount(true);
    expect(h.filters).toContainEqual({ column: "caller_user_id", value: "viewer" });
    root.unmount();
  });
});
