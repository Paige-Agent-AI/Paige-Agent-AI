// _shared/finance-entitlement.ts — the one edge reader and the credit caller checks (E09 F1b).
//
// Run: deno test --allow-import=deno.land --node-modules-dir=none --deny-net --deny-env --deny-read \
//        --deny-write --deny-run --deny-ffi --deny-sys supabase/functions/_shared/finance-entitlement.test.ts

import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  contactAccessible,
  financeEntitled,
  portalCustomerTier,
  refuseCustomerTier,
  requireFinanceEntitlement,
  staffOfBusiness,
  staffOfSubject,
} from "./finance-entitlement.ts";

type Answer = { data?: unknown; error?: { message: string } | null; throws?: boolean };

function fakeDb(answers: Record<string, Answer | ((args: Record<string, unknown>) => Answer)>) {
  const calls: { fn: string; args: Record<string, unknown> }[] = [];
  return {
    calls,
    rpc: (fn: string, args: Record<string, unknown> = {}) => {
      calls.push({ fn, args });
      const a = answers[fn];
      const ans = typeof a === "function" ? a(args) : a;
      if (!ans) return Promise.resolve({ data: null, error: { message: `unexpected ${fn}` } });
      if (ans.throws) return Promise.reject(new Error("network"));
      return Promise.resolve({ data: ans.data ?? null, error: ans.error ?? null });
    },
  };
}

const quiet = async <T>(fn: () => Promise<T>): Promise<T> => {
  const e = console.error;
  console.error = () => {};
  try { return await fn(); } finally { console.error = e; }
};

Deno.test("financeEntitled calls _tenant_finance_entitled with the business id", async () => {
  const db = fakeDb({ _tenant_finance_entitled: { data: true } });
  assertEquals(await financeEntitled(db, "t1"), "entitled");
  assertEquals(db.calls, [{ fn: "_tenant_finance_entitled", args: { _tenant: "t1" } }]);
});

Deno.test("financeEntitled: only an explicit true is entitled", async () => {
  for (const data of [false, null, "true", 1]) {
    assertEquals(await financeEntitled(fakeDb({ _tenant_finance_entitled: { data } }), "t1"), "not_entitled", String(data));
  }
});

Deno.test("financeEntitled fails closed: no business, an RPC error, or a throw is read_error (never entitled)", async () => {
  const none = fakeDb({});
  assertEquals(await financeEntitled(none, null), "read_error");
  assertEquals(await financeEntitled(none, ""), "read_error");
  assertEquals(none.calls.length, 0, "no call without a business");
  assertEquals(await quiet(() => financeEntitled(fakeDb({ _tenant_finance_entitled: { error: { message: "x" } } }), "t1")), "read_error");
  assertEquals(await quiet(() => financeEntitled(fakeDb({ _tenant_finance_entitled: { throws: true } }), "t1")), "read_error");
});

Deno.test("requireFinanceEntitlement: ok / 403 not_entitled / 503 entitlement_unavailable", async () => {
  assertEquals(await requireFinanceEntitlement(fakeDb({ _tenant_finance_entitled: { data: true } }), "t1"), { ok: true });
  assertEquals(await requireFinanceEntitlement(fakeDb({ _tenant_finance_entitled: { data: false } }), "t1"),
    { ok: false, status: 403, error: "not_entitled" });
  assertEquals(await quiet(() => requireFinanceEntitlement(fakeDb({ _tenant_finance_entitled: { error: { message: "x" } } }), "t1")),
    { ok: false, status: 503, error: "entitlement_unavailable" });
});

Deno.test("portalCustomerTier / refuseCustomerTier: a customer is refused 403, staff pass, errors refuse 503", async () => {
  const db = fakeDb({ _user_is_portal_customer_only: (a) => ({ data: a._user === "cust" }) });
  assertEquals(await portalCustomerTier(db, "cust"), "customer");
  assertEquals(await portalCustomerTier(db, "staff"), "not_customer");
  assertEquals(db.calls[0], { fn: "_user_is_portal_customer_only", args: { _user: "cust" } });
  assertEquals(await refuseCustomerTier(db, "cust"), { ok: false, status: 403, error: "customer_credit_not_available" });
  assertEquals(await refuseCustomerTier(db, "staff"), { ok: true });
  assertEquals(await quiet(() => refuseCustomerTier(fakeDb({ _user_is_portal_customer_only: { error: { message: "x" } } }), "u")),
    { ok: false, status: 503, error: "caller_tier_unavailable" });
  assertEquals(await refuseCustomerTier(fakeDb({}), null), { ok: false, status: 503, error: "caller_tier_unavailable" });
});

Deno.test("staffOfBusiness: platform owner passes everywhere; otherwise owner/admin of THAT business only", async () => {
  const db = fakeDb({
    is_platform_owner: (a) => ({ data: a._user_id === "op" }),
    is_tenant_admin_as: (a) => ({ data: a._actor === "adminA" && a._tenant === "A" }),
  });
  assertEquals(await staffOfBusiness(db, "op", "B"), { ok: true });
  assertEquals(await staffOfBusiness(db, "adminA", "A"), { ok: true });
  assertEquals(await staffOfBusiness(db, "adminA", "B"), { ok: false, status: 403, error: "forbidden" });
  assertEquals(await staffOfBusiness(db, "adminA", null), { ok: false, status: 403, error: "forbidden" });
  // The global `admin` app role is never consulted.
  assertEquals(db.calls.some((c) => c.fn === "has_role"), false);
});

Deno.test("staffOfBusiness fails closed on a read error", async () => {
  assertEquals(await staffOfBusiness(fakeDb({ is_platform_owner: { error: { message: "x" } } }), "u", "A"),
    { ok: false, status: 503, error: "authority_unavailable" });
  assertEquals(await staffOfBusiness(fakeDb({ is_platform_owner: { data: false }, is_tenant_admin_as: { error: { message: "x" } } }), "u", "A"),
    { ok: false, status: 503, error: "authority_unavailable" });
  assertEquals(await quiet(() => staffOfBusiness(fakeDb({ is_platform_owner: { throws: true } }), "u", "A")),
    { ok: false, status: 503, error: "authority_unavailable" });
});

Deno.test("contactAccessible asks can_access_contact; only an explicit true passes; errors are 503", async () => {
  const db = fakeDb({ can_access_contact: (a) => ({ data: a._user_id === "staff" && a._contact_id === "c1" }) });
  assertEquals(await contactAccessible(db, "staff", "c1"), { ok: true });
  assertEquals(await contactAccessible(db, "staff", "c2"), { ok: false, status: 403, error: "forbidden" });
  assertEquals(db.calls[0], { fn: "can_access_contact", args: { _user_id: "staff", _contact_id: "c1" } });
  assertEquals(await contactAccessible(fakeDb({ can_access_contact: { error: { message: "x" } } }), "s", "c"),
    { ok: false, status: 503, error: "authority_unavailable" });
});

function seatDb(answers: Parameters<typeof fakeDb>[0], seats: { user_id: string; tenant_id: string }[], seatErr = false) {
  const db = fakeDb(answers);
  return Object.assign(db, {
    from: (_t: string) => {
      const f: [string, unknown][] = [];
      const b: Record<string, unknown> = {
        select: () => b,
        eq: (c: string, v: unknown) => { f.push([c, v]); return b; },
        then: (ok: (v: unknown) => unknown) => Promise.resolve(seatErr ? { data: null, error: { message: "x" } }
          : { data: seats.filter((r) => f.every(([c, v]) => c === "status" || (r as Record<string, unknown>)[c] === v)), error: null }).then(ok),
      };
      return b;
    },
  });
}

Deno.test("staffOfSubject: a portal-customer subject is refused for everyone, even the platform owner", async () => {
  const db = seatDb({ _user_is_portal_customer_only: (a) => ({ data: a._user === "cust" }), is_platform_owner: { data: true } }, []);
  assertEquals(await staffOfSubject(db, "op", "cust"), { ok: false, status: 403, error: "customer_credit_not_available" });
});

Deno.test("staffOfSubject: owner/admin of a business where the subject holds a seat passes; elsewhere refused", async () => {
  const answers = {
    _user_is_portal_customer_only: { data: false },
    is_platform_owner: (a: Record<string, unknown>) => ({ data: a._user_id === "op" }),
    is_tenant_admin_as: (a: Record<string, unknown>) => ({ data: a._actor === "adminA" && a._tenant === "A" }),
  };
  const seats = [{ user_id: "subj", tenant_id: "A" }];
  assertEquals(await staffOfSubject(seatDb(answers, seats), "adminA", "subj"), { ok: true });
  assertEquals(await staffOfSubject(seatDb(answers, seats), "adminB", "subj"), { ok: false, status: 403, error: "forbidden" });
  assertEquals(await staffOfSubject(seatDb(answers, seats), "op", "subj"), { ok: true });
  assertEquals(await staffOfSubject(seatDb(answers, seats, true), "adminA", "subj"), { ok: false, status: 503, error: "authority_unavailable" });
});
