/**
 * INT-326 — the browser half of "a person's own memory is recalled only in the workspace it was
 * written in". `useClientChatContext` reads `client_memory` under the caller's JWT and sends the result
 * to Paige as `clientContext`. With no client in focus it read `client_user_id = me`, and the
 * `client_memory` RLS arm `client_user_id = auth.uid()` admits that person's rows from EVERY workspace.
 *
 * The fake below models the table the way the database answers: it returns every row the filters
 * admit, so an unfiltered read returns the other workspace's row too — the defect, not a fixture quirk.
 */
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const WS_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const WS_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const ME = "44444444-4444-4444-8444-444444444444";
const CLIENT = "55555555-5555-4555-8555-555555555555";

const h = vi.hoisted(() => ({
  active: { data: null as string | null, error: null as unknown },
  reads: [] as Array<{ table: string; filters: unknown[][] }>,
  rpcs: [] as string[],
  rows: [] as Array<Record<string, unknown>>,
  /** What <TenantProvider> currently says the active workspace is; null = rendered without one. */
  ctx: null as { activeTenantId: string | null } | null,
  /** When set, the active-workspace lookup waits on it — models a re-read still in flight. */
  hold: null as Promise<void> | null,
}));

vi.mock("@/hooks/useTenantContext", () => ({ useOptionalTenantContext: () => h.ctx }));

vi.mock("@/integrations/supabase/client", () => {
  const builder = (table: string) => {
    const filters: unknown[][] = [];
    const answer = () => {
      h.reads.push({ table, filters });
      if (table !== "client_memory") return { data: null, error: null };
      const rows = h.rows.filter((r) => filters.every((f) => {
        if ((f[0] === "eq" || f[0] === "is") && typeof f[1] === "string" && f[1] in r) return r[f[1]] === f[2];
        return true;
      }));
      return { data: rows, error: null };
    };
    const b: Record<string, unknown> = {};
    for (const m of ["select", "neq", "in", "gte", "lte", "order", "limit", "not", "or", "filter"]) {
      b[m] = (...a: unknown[]) => { if (m !== "select") filters.push([m, ...a]); return b; };
    }
    b.eq = (c: string, v: unknown) => { filters.push(["eq", c, v]); return b; };
    b.is = (c: string, v: unknown) => { filters.push(["is", c, v]); return b; };
    b.maybeSingle = async () => { const r = answer(); return { data: Array.isArray(r.data) ? r.data[0] ?? null : r.data, error: null }; };
    b.single = b.maybeSingle;
    b.then = (ok: (v: unknown) => unknown, bad?: (e: unknown) => unknown) => Promise.resolve(answer()).then(ok, bad);
    return b;
  };
  return {
    supabase: {
      from: (t: string) => builder(t),
      rpc: async (name: string) => {
        h.rpcs.push(name);
        if (name === "current_user_tenant_id" && h.hold) await h.hold;
        return name === "current_user_tenant_id" ? h.active : { data: null, error: null };
      },
    },
  };
});

import { useClientChatContext, type ClientChatContext } from "./useClientChatContext";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLDivElement | null = null;
afterEach(() => {
  if (root) act(() => root?.unmount());
  root = null;
  host?.remove();
  host = null;
});

/** Mounts the hook and returns a live view of its latest result (no testing-library in this repo). */
function renderHook(clientId: string | null, userId: string | null) {
  const result: { current: ClientChatContext } = { current: { contextBlock: "", isLoading: true, hasCreditData: false, hasCompletedIntake: false } };
  function Harness() {
    result.current = useClientChatContext(clientId, userId);
    return null;
  }
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => root?.render(<Harness />));
  /** Re-renders the same mounted hook, the way PaigeChat re-renders when the tenant context changes. */
  const rerender = () => act(() => root?.render(<Harness />));
  return { result, rerender };
}

/** Polls an assertion until it holds, flushing React between attempts. */
async function waitFor(check: () => void, timeoutMs = 3000) {
  const started = Date.now();
  for (;;) {
    try { check(); return; } catch (e) {
      if (Date.now() - started > timeoutMs) throw e;
      await act(async () => { await new Promise((r) => setTimeout(r, 10)); });
    }
  }
}

const memoryReads = () => h.reads.filter((r) => r.table === "client_memory");
const has = (filters: unknown[][], op: string, col: string, val: unknown) =>
  filters.some((f) => f[0] === op && f[1] === col && f[2] === val);

beforeEach(() => {
  h.reads.length = 0;
  h.rpcs.length = 0;
  h.active = { data: WS_A, error: null };
  h.ctx = null;
  h.hold = null;
  const now = new Date().toISOString();
  h.rows = [
    { client_user_id: ME, client_id: null, tenant_id: WS_A, is_active: true, memory_type: "user_preference", content: "WRITTEN-IN-A", created_at: now },
    { client_user_id: ME, client_id: null, tenant_id: WS_B, is_active: true, memory_type: "user_preference", content: "WRITTEN-IN-B", created_at: now },
    // A row this person wrote ABOUT a client (client_user_id = the actor). Not their own memory.
    { client_user_id: ME, client_id: CLIENT, tenant_id: WS_A, is_active: true, memory_type: "coach_note", content: "ABOUT-A-CLIENT", created_at: now },
  ];
});

describe("useClientChatContext — own memory is read in the active workspace only (INT-326)", () => {
  it("in workspace A, reads only A's own rows and shows only them", async () => {
    const { result } = renderHook(null, ME);
    await waitFor(() => expect(result.current.contextBlock).toContain("Recent Memory"));
    const read = memoryReads()[0];
    expect(read).toBeDefined();
    expect(has(read.filters, "eq", "client_user_id", ME)).toBe(true);
    expect(has(read.filters, "eq", "tenant_id", WS_A)).toBe(true);
    expect(has(read.filters, "is", "client_id", null)).toBe(true);
    expect(result.current.contextBlock).toContain("WRITTEN-IN-A");
    expect(result.current.contextBlock).not.toContain("WRITTEN-IN-B");
    expect(result.current.contextBlock).not.toContain("ABOUT-A-CLIENT");
  });

  it("the same person in workspace B never sees what they wrote in A", async () => {
    h.active = { data: WS_B, error: null };
    const { result } = renderHook(null, ME);
    await waitFor(() => expect(result.current.contextBlock).toContain("Recent Memory"));
    expect(has(memoryReads()[0].filters, "eq", "tenant_id", WS_B)).toBe(true);
    expect(result.current.contextBlock).toContain("WRITTEN-IN-B");
    expect(result.current.contextBlock).not.toContain("WRITTEN-IN-A");
  });

  it("with no active workspace (or a failed lookup) there is no memory read and no Recent Memory line", async () => {
    for (const active of [{ data: null, error: null }, { data: null, error: { message: "down" } }]) {
      if (root) act(() => root?.unmount());
      root = null;
      h.reads.length = 0;
      h.active = active;
      const { result } = renderHook(null, ME);
      await waitFor(() => expect(result.current.isLoading).toBe(false));
      await waitFor(() => expect(h.reads.length).toBeGreaterThan(0));
      expect(memoryReads()).toHaveLength(0);
      expect(result.current.contextBlock).not.toContain("Recent Memory");
    }
  });

  it("a focused client keeps reading that client's memory, unchanged", async () => {
    const { result } = renderHook(CLIENT, null);
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    await waitFor(() => expect(memoryReads().length).toBeGreaterThan(0));
    const read = memoryReads()[0];
    expect(has(read.filters, "eq", "client_id", CLIENT)).toBe(true);
    expect(read.filters.some((f) => f[1] === "tenant_id")).toBe(false);
  });

  it("a workspace switch while the chat stays mounted re-reads own memory with the NEW workspace filter", async () => {
    h.ctx = { activeTenantId: WS_A };
    const { result, rerender } = renderHook(null, ME);
    await waitFor(() => expect(result.current.contextBlock).toContain("WRITTEN-IN-A"));
    expect(memoryReads()).toHaveLength(1);

    // The user switches to workspace B (another tab, or the switcher). PaigeChat is NOT remounted:
    // only the tenant context changes, and the server-side active workspace moves with it.
    h.active = { data: WS_B, error: null };
    h.ctx = { activeTenantId: WS_B };
    rerender();

    await waitFor(() => expect(memoryReads()).toHaveLength(2));
    expect(has(memoryReads()[1].filters, "eq", "tenant_id", WS_B)).toBe(true);
    await waitFor(() => expect(result.current.contextBlock).toContain("WRITTEN-IN-B"));
    expect(result.current.contextBlock).not.toContain("WRITTEN-IN-A");
  });

  it("while the post-switch re-read is still in flight, the block no longer carries A's own memory", async () => {
    h.ctx = { activeTenantId: WS_A };
    const { result, rerender } = renderHook(null, ME);
    await waitFor(() => expect(result.current.contextBlock).toContain("WRITTEN-IN-A"));

    // Hold the new workspace lookup so the re-read cannot finish: anything sent now is sent mid-read.
    let release: () => void = () => {};
    h.hold = new Promise<void>((r) => { release = r; });
    h.active = { data: WS_B, error: null };
    h.ctx = { activeTenantId: WS_B };
    rerender();

    await waitFor(() => expect(result.current.isLoading).toBe(true));
    expect(result.current.contextBlock).not.toContain("WRITTEN-IN-A");

    release();
    await waitFor(() => expect(result.current.contextBlock).toContain("WRITTEN-IN-B"));
    expect(result.current.contextBlock).not.toContain("WRITTEN-IN-A");
  });
});
