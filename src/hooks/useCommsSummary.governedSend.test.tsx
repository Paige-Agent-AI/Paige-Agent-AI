/**
 * INT-328 — the "drafts awaiting you" count never counts a governed send.
 *
 * A governed email (`meta.comms_email_binding`) or invoice delivery (`meta.sales_invoice_binding`)
 * is written as an outbound 'draft' row before it leaves, and stays one when its outcome could not
 * be confirmed. It is not waiting on the owner, so the Command Center tile must not say it is. This
 * records the exact PostgREST filters the count sends.
 *
 * PROOF CLASS: automated (the query the hook builds). The filter's behaviour against the live
 * database is a separate, read-only check recorded in the evidence file.
 */
import { act } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";

const calls = vi.hoisted(() => [] as Array<{ table: string; ops: Array<[string, unknown[]]> }>);

vi.mock("@/integrations/supabase/client", () => {
  const builder = (table: string) => {
    const entry = { table, ops: [] as Array<[string, unknown[]]> };
    calls.push(entry);
    const proxy: Record<string, unknown> = new Proxy({}, {
      get(_t, key) {
        if (key === "then") return (ok: (v: unknown) => void) => ok({ count: 0, error: null });
        return (...args: unknown[]) => { entry.ops.push([String(key), args]); return proxy; };
      },
    });
    return proxy;
  };
  const channel = { on: () => channel, subscribe: () => channel };
  return { supabase: { from: builder, channel: () => channel, removeChannel: () => {} } };
});
vi.mock("@/hooks/useTenantContext", () => ({ useTenantContext: () => ({ activeTenantId: "tenant-a" }) }));

import { useCommsSummary } from "./useCommsSummary";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function Probe() { useCommsSummary(); return null; }

describe("useCommsSummary — drafts awaiting you", () => {
  it("excludes rows carrying a governed-send binding from the draft count", async () => {
    calls.length = 0;
    const host = document.createElement("div");
    const root = createRoot(host);
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    await act(async () => {
      root.render(<QueryClientProvider client={qc}><Probe /></QueryClientProvider>);
      for (let i = 0; i < 10; i += 1) await Promise.resolve();
    });
    const drafts = calls.find((c) => c.table === "messages" && c.ops.some(([op, a]) => op === "eq" && a[0] === "status" && a[1] === "draft"));
    expect(drafts).toBeTruthy();
    const nulls = drafts!.ops.filter(([op]) => op === "is").map(([, a]) => a);
    expect(nulls).toEqual(expect.arrayContaining([["meta->comms_email_binding", null], ["meta->sales_invoice_binding", null]]));
    // Still tenant-scoped (§9) and still outbound only.
    expect(drafts!.ops).toEqual(expect.arrayContaining([["eq", ["tenant_id", "tenant-a"]], ["eq", ["direction", "outbound"]]]));
    await act(async () => { root.unmount(); });
  });
});
