// deno test --allow-read supabase/functions/_shared/owner-context.test.ts
//
// O-3 review P3-7: lock the customer book's honesty behaviors — the exact counts
// (a limit page is never reported as the total), the canceled/expired split, and
// the DERIVED collected-cash line (a hardcoded $0.00 would silently contradict
// the Real ARR block the moment a live paid subscription exists).
import { assert, assertEquals, assertStringIncludes } from "https://deno.land/std@0.190.0/testing/asserts.ts";
import { loadOwnerContextBlock } from "./owner-context.ts";

/**
 * A thenable stand-in for the service-role client. Every chain captures its
 * filters so the resolver can discriminate call shapes on the SAME table
 * (platform_subscriptions serves three different reads in one compose).
 */
type Response = { data?: unknown; error?: { message: string } | null; count?: number | null };
type Resolver = (table: string, chain: Chain) => Response;

class Chain implements PromiseLike<Response> {
  filters: string[] = [];
  columns = "";
  head = false;
  single = false;
  constructor(
    private table: string,
    private resolve: Resolver,
  ) {}
  select(columns: string, opts?: { count?: string; head?: boolean }) {
    this.columns = columns;
    this.head = !!(opts && opts.head);
    return this;
  }
  eq(col: string, val: unknown) {
    this.filters.push(`${col}=${String(val)}`);
    return this;
  }
  is(col: string, val: unknown) {
    this.filters.push(`${col} is ${val === null ? "null" : String(val)}`);
    return this;
  }
  not(col: string, _op: string, val: unknown) {
    this.filters.push(`${col} not ${val}`);
    return this;
  }
  in(col: string, vals: unknown[]) {
    this.filters.push(`${col} in (${vals.join(",")})`);
    return this;
  }
  order(_col: string, _opts?: unknown) {
    return this;
  }
  limit(_n: number) {
    return this;
  }
  maybeSingle() {
    this.single = true;
    return this;
  }
  then<TRes = Response, TRej = never>(
    onFulfilled?: ((value: Response) => TRes | PromiseLike<TRes>) | null,
    onRejected?: ((reason: unknown) => TRej | PromiseLike<TRej>) | null,
  ): PromiseLike<TRes | TRej> {
    return Promise.resolve(this.resolve(this.table, this)).then(onFulfilled, onRejected);
  }
}

function mockAdmin(resolve: Resolver, firstName: string | null = null) {
  return {
    auth: { admin: { getUserById: () => firstName ? { data: { user: { user_metadata: { full_name: firstName } } }, error: null } : { data: { user: {} }, error: null } } },
    from: (table: string) => new Chain(table, resolve),
  } as unknown as Parameters<typeof loadOwnerContextBlock>[0];
}

/** The baseline resolver every case overrides: an idle platform, empty book. */
function baseResolve(overrides: (table: string, chain: Chain) => Response | undefined) {
  return (table: string, chain: Chain): Response => {
    const hit = overrides(table, chain);
    if (hit) return hit;
    if (table === "paige_owner_memory") return { data: [{ memory_type: "priority", content: "ship", created_at: "2026-10-19" }] };
    if (table === "tenant_revenue_classification") return { data: [] };
    if (table === "paige_systems_check_run") return { data: [] };
    // ARR read (rows, not head) vs paid-count (head) vs newest-customer sub (maybeSingle).
    if (table === "platform_subscriptions") {
      if (chain.head) return { count: 0 };
      if (chain.single) return { data: null };
      return { data: [] };
    }
    if (table === "solo_beta_enrollments") {
      if (chain.head) return { count: 0 };
      return { data: [] };
    }
    if (table === "solo_beta_welcome_deliveries") return { data: null };
    return { data: [] };
  };
}

Deno.test("an empty book says so, in one honest line (no cash statement without customers)", async () => {
  const block = await loadOwnerContextBlock(mockAdmin(baseResolve(() => undefined)), "u1");
  assert(block !== null);
  assertStringIncludes(block, "- Customers: no Solo Beta enrollments yet.");
  assertEquals(block.includes("Collected cash:"), false);
});

Deno.test("counts are exact and terminal states are not 'in progress' (12 enrollments, limit page was 10)", async () => {
  const resolve = baseResolve((table, chain) => {
    if (table === "solo_beta_enrollments" && chain.head) {
      if (chain.filters.includes("state=fulfilled")) return { count: 7 };
      if (chain.filters.includes("state=canceled")) return { count: 2 };
      if (chain.filters.includes("state=expired")) return { count: 1 };
      return { count: 12 }; // total — deliberately past the old limit(10) trap
    }
    if (table === "solo_beta_enrollments" && !chain.head) {
      return { data: [{ user_id: "u9", state: "fulfilled", checkout_claimed_at: "2026-10-19", tenant_id: "t9", stripe_subscription_id: "sub_1", reference_id: "ref9" }] };
    }
    if (table === "tenants") return { data: { name: "Acmey Advisory" } };
    return undefined;
  });
  const block = await loadOwnerContextBlock(mockAdmin(resolve), "u1");
  assert(block !== null);
  assertStringIncludes(block, "- Customers: 12 Solo Beta enrollments — 7 fulfilled, 2 in progress, 3 canceled/expired.");
  assertStringIncludes(block, "Newest customer: Acmey Advisory");
});

Deno.test("the collected-cash line follows the paid-count read, not a hardcoded zero", async () => {
  // A non-empty book is what reaches the collected-cash section.
  const withPaid = (count: number | { error: true }) =>
    baseResolve((table, chain) => {
      if (table === "solo_beta_enrollments" && chain.head) {
        if (chain.filters.includes("state=fulfilled")) return { count: 1 };
        return { count: 1 };
      }
      if (table === "solo_beta_enrollments" && !chain.head) {
        return { data: [{ user_id: "u9", state: "fulfilled", checkout_claimed_at: "2026-10-19", tenant_id: "t9", stripe_subscription_id: "sub_1", reference_id: "ref9" }] };
      }
      // paid-count = head query with status=active + stripe id not null
      if (table === "platform_subscriptions" && chain.head && chain.filters.includes("status=active")) {
        return typeof count === "number" ? { count } : { count: null, error: { message: "boom" } };
      }
      return undefined;
    });

  const zero = await loadOwnerContextBlock(mockAdmin(withPaid(0)), "u1");
  assertStringIncludes(zero!, "Collected cash: $0.00 — no Stripe payment has been confirmed yet");

  const paid = await loadOwnerContextBlock(mockAdmin(withPaid(2)), "u1");
  assertStringIncludes(paid!, "Collected cash: 2 live Stripe-backed paid subscriptions — see Real ARR above");
  assertEquals(paid!.includes("no Stripe payment has been confirmed"), false);

  const failed = await loadOwnerContextBlock(mockAdmin(withPaid({ error: true })), "u1");
  assertStringIncludes(failed!, "Collected cash: not available right now (paid-subscription read failed)");
});
