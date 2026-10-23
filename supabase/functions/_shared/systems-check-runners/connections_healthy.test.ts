// deno test supabase/functions/_shared/systems-check-runners/connections_healthy.test.ts
//
// Deno-native for the same reason the sibling runner tests are: this module lives in the Deno
// edge graph. WHAT THESE PIN: the §9 tenant filter (a service-role runner has no RLS underneath
// it — a missing tenant_id filter is the single most expensive mistake this codebase makes), the
// three state classes (erroring / stale / configured), the fail/pass boundaries, the honest
// vacuous pass, and the same-recorded-error fail-loud contract as every sibling.
import { assertEquals } from "https://deno.land/std@0.190.0/testing/asserts.ts";
import { run, runnerKey } from "./connections_healthy.ts";

type Recorded = { table: string; filters: Array<[string, unknown]> };

/** Chainable stand-in that RECORDS every filter (the sibling suites' proven pattern: a double
 *  that discards eq() arguments cannot fail on a deleted §9 tenant filter). */
function fakeAdmin(
  counts: { error: number; stale: number; total: number },
  opts?: { errorOn?: string; calls?: Recorded[] },
  // deno-lint-ignore no-explicit-any
): any {
  return {
    from(table: string) {
      const record: Recorded = { table, filters: [] };
      opts?.calls?.push(record);
      const builder = {
        // deno-lint-ignore no-explicit-any
        select(_sel: unknown, _opts: any) { return builder; },
        eq(column: string, value: unknown) { record.filters.push([column, value]); return builder; },
        or(_expr: string) { return builder; },
        then(resolve: (v: unknown) => void) {
          if (opts?.errorOn === table) {
            resolve({ data: null, count: null, error: { message: "db down", code: "XX000" } });
            return;
          }
          // Distinguish the three reads by their recorded status/enabled filter values.
          const statusFilter = record.filters.find(([c]) => c === "status");
          const enabledFilter = record.filters.find(([c]) => c === "enabled");
          let count = counts.total;
          if (statusFilter && !enabledFilter) {
            count = statusFilter[1] === "error" ? counts.error : counts.stale;
          }
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

Deno.test("pass: zero configured is an honest vacuous pass, not a fail", async () => {
  const r = await run(ctx(fakeAdmin({ error: 0, stale: 0, total: 0 })), row);
  assertEquals(r.status, "pass");
  assertEquals(r.evidence.configured_connections, 0);
});

Deno.test("pass: configured, all fresh and healthy", async () => {
  const r = await run(ctx(fakeAdmin({ error: 0, stale: 0, total: 2 })), row);
  assertEquals(r.status, "pass");
  assertEquals(r.evidence.configured_connections, 2);
});

Deno.test("fail: one recorded error among healthy connections", async () => {
  const r = await run(ctx(fakeAdmin({ error: 1, stale: 0, total: 2 })), row);
  assertEquals(r.status, "fail");
  assertEquals(r.evidence.erroring_connections, 1);
  assertEquals(typeof r.interpretation, "string");
});

Deno.test("fail: a stale connected-claiming connection (probe older than 7 days)", async () => {
  const r = await run(ctx(fakeAdmin({ error: 0, stale: 1, total: 1 })), row);
  assertEquals(r.status, "fail");
  assertEquals(r.evidence.stale_connections, 1);
});

Deno.test("the stale predicate mirrors the surface's 7-day interval", async () => {
  const r = await run(ctx(fakeAdmin({ error: 0, stale: 0, total: 1 })), row);
  assertEquals(r.evidence.stale_after_days, 7);
});

Deno.test("§9: every read is tenant-scoped (no unfiltered table access)", async () => {
  const calls: Recorded[] = [];
  await run(ctx(fakeAdmin({ error: 0, stale: 0, total: 0 }, { calls })), row);
  assertEquals(calls.length, 3);
  for (const c of calls) {
    assertEquals(c.table, "tenant_mcp_connections");
    const tenant = c.filters.find(([col]) => col === "tenant_id");
    assertEquals(tenant !== undefined, true, "a read lacked the tenant_id filter");
    assertEquals(tenant![1], "tenant-a");
  }
});

Deno.test("§32 fail-loud: a registry read error is status error, never a silent pass", async () => {
  const r = await run(ctx(fakeAdmin({ error: 0, stale: 0, total: 0 }, { errorOn: "tenant_mcp_connections" })), row);
  assertEquals(r.status, "error");
  assertEquals(r.evidence.runner_key, "connections_healthy");
});
