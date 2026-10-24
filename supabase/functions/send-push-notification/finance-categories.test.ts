// The credit/funding push categories reach only staff of a finance-entitled business (E09 F1b).
//
// Run: deno test --allow-import=deno.land --allow-read=supabase/functions --node-modules-dir=none \
//        --deny-net --deny-env --deny-write --deny-run --deny-ffi --deny-sys \
//        supabase/functions/send-push-notification/finance-categories.test.ts

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { FINANCE_PUSH_CATEGORIES, financePushGate } from "./finance-categories.ts";

const ENTITLED = "11111111-1111-4111-8111-111111111111";
const PLAIN = "22222222-2222-4222-8222-222222222222";
const STAFF = "33333333-3333-4333-8333-333333333333";
const CUSTOMER = "44444444-4444-4444-8444-444444444444";

function fakeDb(opts: { entitledErr?: boolean; seatErr?: boolean } = {}) {
  const seats = [{ tenant_id: ENTITLED, user_id: STAFF, status: "active" }];
  const calls: string[] = [];
  return {
    calls,
    rpc: (fn: string, args: Record<string, unknown> = {}) => {
      calls.push(`rpc:${fn}`);
      if (fn !== "_tenant_finance_entitled") return Promise.resolve({ data: null, error: { message: "unexpected" } });
      if (opts.entitledErr) return Promise.resolve({ data: null, error: { message: "down" } });
      return Promise.resolve({ data: args._tenant === ENTITLED, error: null });
    },
    from: (table: string) => {
      calls.push(`from:${table}`);
      const f: [string, unknown][] = [];
      const b: Record<string, unknown> = {
        select: () => b,
        eq: (c: string, v: unknown) => { f.push([c, v]); return b; },
        then: (ok: (v: unknown) => unknown) => Promise.resolve(opts.seatErr
          ? { data: null, error: { message: "down" } }
          : { data: seats.filter((r) => f.every(([c, v]) => (r as Record<string, unknown>)[c] === v)), error: null }).then(ok),
      };
      return b;
    },
  };
}

const quiet = async <T>(fn: () => Promise<T>) => { const e = console.error; console.error = () => {}; try { return await fn(); } finally { console.error = e; } };

for (const category of FINANCE_PUSH_CATEGORIES) {
  Deno.test(`${category}: staff of an entitled business → sent`, async () => {
    assertEquals(await financePushGate(fakeDb(), { tenant_id: ENTITLED, user_id: STAFF, category }), null);
  });
  Deno.test(`${category}: a non-entitled business → skipped:not_entitled, recipient never read`, async () => {
    const db = fakeDb();
    assertEquals(await financePushGate(db, { tenant_id: PLAIN, user_id: STAFF, category }),
      { skipped: "not_entitled", reason: "business_not_entitled" });
    assert(!db.calls.includes("from:tenant_members"));
  });
  Deno.test(`${category}: a portal customer of an entitled business → skipped:not_entitled`, async () => {
    assertEquals(await financePushGate(fakeDb(), { tenant_id: ENTITLED, user_id: CUSTOMER, category }),
      { skipped: "not_entitled", reason: "recipient_not_business_staff" });
  });
}

Deno.test("fail closed: an entitlement or seat read error skips", async () => {
  assertEquals(await quiet(() => financePushGate(fakeDb({ entitledErr: true }), { tenant_id: ENTITLED, user_id: STAFF, category: "funding_matches" })),
    { skipped: "not_entitled", reason: "entitlement_unavailable" });
  assertEquals(await financePushGate(fakeDb({ seatErr: true }), { tenant_id: ENTITLED, user_id: STAFF, category: "funding_matches" }),
    { skipped: "not_entitled", reason: "entitlement_unavailable" });
});

Deno.test("every other category is untouched (no read at all)", async () => {
  for (const category of ["task_reminders", "comms_inbox", "general"]) {
    const db = fakeDb();
    assertEquals(await financePushGate(db, { tenant_id: PLAIN, user_id: CUSTOMER, category }), null);
    assertEquals(db.calls, []);
  }
});

Deno.test("the handler runs the gate before reading preferences or subscriptions", () => {
  const src = Deno.readTextFileSync("supabase/functions/send-push-notification/index.ts");
  const gate = src.indexOf("await financePushGate(supabase, { tenant_id, user_id, category })");
  const prefs = src.indexOf('.from("push_notification_preferences")');
  const subs = src.indexOf('.from("push_subscriptions")', prefs);
  const auth = src.indexOf("isAuthorizedInternalCaller(req, supabase)");
  assert(gate > 0 && auth > 0 && auth < gate && gate < prefs && prefs < subs, JSON.stringify({ auth, gate, prefs, subs }));
});
