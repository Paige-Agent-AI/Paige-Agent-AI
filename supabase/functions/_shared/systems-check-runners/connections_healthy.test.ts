// deno test supabase/functions/_shared/systems-check-runners/connections_healthy.test.ts
//
// Deno-native for the same reason the sibling runner tests are: this module lives in the Deno
// edge graph. WHAT THESE PIN: the §9 tenant filter on EVERY read (a service-role runner has no
// RLS underneath it — the sibling suites' review-proven pattern of CAPTURING filter arguments,
// never discarding them), the three-store coverage (legacy registry + native gateway store +
// n8n API facet — the review P2: a native-only error must fail the check), the stale
// predicates' or-expressions and status values (review P3-1: a double that drops them cannot
// fail on a deleted predicate), the 7-day interval, and §32 fail-loud.
import { assertEquals } from "https://deno.land/std@0.190.0/testing/asserts.ts";
import { run, runnerKey } from "./connections_healthy.ts";

type Recorded = { table: string; filters: Array<[string, unknown]>, orExpr: string | null, isNull: string[] };

/** Chainable stand-in that RECORDS every filter, or-expression and is-null filter, and
 *  dispatches counts per (table, read-class) so the three stores are exercised independently. */
function fakeAdmin(
  counts: {
    legacyError?: number; legacyStale?: number;
    gatewayError?: number; gatewayStale?: number;
    n8nError?: number; n8nStale?: number;
  },
  opts?: { errorOn?: string; calls?: Recorded[] },
  // deno-lint-ignore no-explicit-any
): any {
  const c = { legacyError: 0, legacyStale: 0, gatewayError: 0, gatewayStale: 0, n8nError: 0, n8nStale: 0, ...counts };
  return {
    from(table: string) {
      const record: Recorded = { table, filters: [], orExpr: null, isNull: [] };
      opts?.calls?.push(record);
      const builder = {
        // deno-lint-ignore no-explicit-any
        select(_sel: unknown, _o: any) { return builder; },
        eq(column: string, value: unknown) { record.filters.push([column, value]); return builder; },
        is(column: string, value: unknown) {
          if (value === null) record.isNull.push(column); else record.filters.push([column, value]);
          return builder;
        },
        or(expr: string) { record.orExpr = expr; return builder; },
        then(resolve: (v: unknown) => void) {
          if (opts?.errorOn === table) {
            resolve({ data: null, count: null, error: { message: "db down", code: "XX000" } });
            return;
          }
          const status = record.filters.find(([col]) => col === "status")?.[1];
          const isStale = record.orExpr !== null;
          let count = 0;
          if (table === "tenant_mcp_connections") count = isStale ? c.legacyStale : (status === "error" ? c.legacyError : 0);
          else if (table === "mcp_connections") count = isStale ? c.gatewayStale : (status === "error" ? c.gatewayError : 0);
          else if (table === "tenant_n8n_connections") count = isStale ? c.n8nStale : (status === "error" ? c.n8nError : 0);
          resolve({ data: null, count, error: null });
        },
      };
      return builder;
    },
  };
}

const ctx = (admin: unknown) => ({ admin, tenantId: "tenant-a" }) as unknown as Parameters<typeof run>[0];
const row = {} as Parameters<typeof run>[1];

Deno.test("connections_healthy: key is stable", () => {
  assertEquals(runnerKey, "connections_healthy");
});

Deno.test("pass: nothing recorded anywhere is an honest pass", async () => {
  const r = await run(ctx(fakeAdmin({})), row);
  assertEquals(r.status, "pass");
  assertEquals(r.evidence.erroring_connections, 0);
  assertEquals(r.evidence.stale_connections, 0);
});

Deno.test("fail: an error in the LEGACY registry alone", async () => {
  const r = await run(ctx(fakeAdmin({ legacyError: 1 })), row);
  assertEquals(r.status, "fail");
  assertEquals(r.evidence.erroring_connections, 1);
});

Deno.test("fail: a stale row in the LEGACY registry alone", async () => {
  const r = await run(ctx(fakeAdmin({ legacyStale: 1 })), row);
  assertEquals(r.status, "fail");
  assertEquals(r.evidence.stale_connections, 1);
});

Deno.test("fail: an error in the NATIVE gateway store alone (the review P2 case)", async () => {
  const r = await run(ctx(fakeAdmin({ gatewayError: 1 })), row);
  assertEquals(r.status, "fail");
  assertEquals(r.evidence.erroring_connections, 1);
});

Deno.test("fail: a stale row in the NATIVE gateway store alone", async () => {
  const r = await run(ctx(fakeAdmin({ gatewayStale: 2 })), row);
  assertEquals(r.status, "fail");
  assertEquals(r.evidence.stale_connections, 2);
});

Deno.test("fail: an error in the n8n API facet alone", async () => {
  const r = await run(ctx(fakeAdmin({ n8nError: 1 })), row);
  assertEquals(r.status, "fail");
  assertEquals(r.evidence.erroring_connections, 1);
});

Deno.test("fail: a stale n8n API row alone (last_sync_at overdue)", async () => {
  const r = await run(ctx(fakeAdmin({ n8nStale: 1 })), row);
  assertEquals(r.status, "fail");
  assertEquals(r.evidence.stale_connections, 1);
});

Deno.test("§9: every one of the six reads is tenant-scoped on the right table", async () => {
  const calls: Recorded[] = [];
  await run(ctx(fakeAdmin({}, { calls })), row);
  assertEquals(calls.length, 6);
  const perTable = new Map<string, number>();
  for (const c of calls) {
    const tenant = c.filters.find(([col]) => col === "tenant_id");
    assertEquals(tenant !== undefined, true, `a read on ${c.table} lacked the tenant_id filter`);
    assertEquals(tenant![1], "tenant-a");
    perTable.set(c.table, (perTable.get(c.table) ?? 0) + 1);
  }
  assertEquals(perTable.get("tenant_mcp_connections"), 2);
  assertEquals(perTable.get("mcp_connections"), 2);
  assertEquals(perTable.get("tenant_n8n_connections"), 2);
});

Deno.test("the native-gateway reads exclude legacy projections (legacy_source IS NULL)", async () => {
  const calls: Recorded[] = [];
  await run(ctx(fakeAdmin({}, { calls })), row);
  const gatewayCalls = calls.filter((c) => c.table === "mcp_connections");
  assertEquals(gatewayCalls.length, 2);
  for (const g of gatewayCalls) {
    assertEquals(g.isNull.includes("legacy_source"), true, "a gateway read did not exclude projections");
  }
});

Deno.test("the stale predicates are the per-store or-expressions with the 7-day cutoff", async () => {
  const calls: Recorded[] = [];
  const r = await run(ctx(fakeAdmin({}, { calls })), row);
  assertEquals(r.evidence.stale_after_days, 7);
  const orByTable = new Map(calls.filter((c) => c.orExpr).map((c) => [c.table, c.orExpr!]));
  assertEquals(orByTable.size, 3);
  const legacy = orByTable.get("tenant_mcp_connections")!;
  assertEquals(legacy.startsWith("last_probed_at.is.null,last_probed_at.lt."), true);
  const gateway = orByTable.get("mcp_connections")!;
  assertEquals(gateway.startsWith("last_checked_at.is.null,last_checked_at.lt."), true);
  const n8n = orByTable.get("tenant_n8n_connections")!;
  assertEquals(n8n.startsWith("last_sync_at.is.null,last_sync_at.lt."), true);
  for (const c of calls.filter((x) => x.orExpr)) {
    assertEquals(c.filters.some(([col, v]) => col === "status" && v === "connected"), true, `${c.table} stale read lost the connected-status filter`);
  }
  for (const c of calls.filter((x) => !x.orExpr)) {
    assertEquals(c.filters.some(([col, v]) => col === "status" && v === "error"), true, `${c.table} error read lost the error-status filter`);
  }
});

Deno.test("§32 fail-loud: a store read error is status error, never a silent pass", async () => {
  const r = await run(ctx(fakeAdmin({}, { errorOn: "mcp_connections" })), row);
  assertEquals(r.status, "error");
  assertEquals(r.evidence.runner_key, "connections_healthy");
});
